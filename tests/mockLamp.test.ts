import { expect, test } from 'bun:test'
import { mockServer, tick, type Env } from './mockHarness'

type Rt = {
  revision: number
  config: { lighting: string; installation_visible: boolean; lamp_slots: Array<{ slot_id: string; position: { x: number; z: number } }> }
  guides: Array<{ position: { x: number; z: number } }>
  lamp: Record<string, unknown>
}

async function joined() {
  const m = await mockServer()
  await m.register()
  const j = await m.join()
  const first = j.inbox.find((e) => e.type === 'world.runtime')!.payload as unknown as Rt
  return { ...m, ...j, epoch: j.snapshot.self.movement_epoch, first }
}
type J = Awaited<ReturnType<typeof joined>>

let seq = 0
const where = new WeakMap<object, { x: number; z: number }>()
/** Идёт к точке шагами по 0,3 м раз в 100 мс: сервер отклоняет шаги быстрее предельной скорости. */
async function walkTo(j: J, x: number, z: number) {
  let cur = { ...(where.get(j.ws) ?? j.snapshot.self.position) }
  for (let i = 0; i < 400; i++) {
    const dx = x - cur.x
    const dz = z - cur.z
    const d = Math.hypot(dx, dz)
    if (d < 1e-6) break
    const k = Math.min(1, 0.3 / d)
    cur = { x: cur.x + dx * k, z: cur.z + dz * k }
    j.clock.advance(100)
    j.send('player.move', { movement_epoch: j.epoch, seq: ++seq, position: { x: cur.x, y: 0, z: cur.z }, rotation: { yaw: 0, pitch: 0 } })
  }
  where.set(j.ws, cur)
  await tick(20)
}

async function call(j: J, type: string, payload: Record<string, unknown>): Promise<Env> {
  const rid = crypto.randomUUID()
  j.send(type, payload, rid)
  await tick()
  return j.inbox.find((e) => e.request_id === rid)!
}
const act = (j: J, revision: number, extra: Record<string, unknown>) =>
  call(j, 'object.act', { object_id: 'lamp_01', movement_epoch: j.epoch, expected_revision: revision, ...extra })
const ask = (j: J, revision: number, text: string) =>
  call(j, 'guide.action', { guide_id: 'guide_leonardo', text, movement_epoch: j.epoch, expected_revision: revision })
const rtOf = (e: Env) => e.payload.runtime as unknown as Rt
const slotPos = (j: J, id: string) => j.first.config.lamp_slots.find((s) => s.slot_id === id)!.position

async function nearLamp() {
  const j = await joined()
  const a = slotPos(j, 'a')
  await walkTo(j, a.x, a.z + 1)
  return j
}

async function nearGuide() {
  const j = await joined()
  const g = j.first.guides[0].position
  await walkTo(j, g.x, g.z + 1.5)
  return j
}

test('object.act: далеко от слота — OUT_OF_RANGE, мир не меняется', async () => {
  const j = await joined()
  const r = await act(j, 1, { action: 'take' })
  expect(r.type).toBe('error')
  expect(r.payload.code).toBe('OUT_OF_RANGE')
})

test('take, затем aim/power/take запрещены в руках, затем place: ревизия растёт на 1', async () => {
  const j = await nearLamp()
  const took = await act(j, 1, { action: 'take' })
  expect(took.type).toBe('object.acted')
  expect(took.payload.action).toBe('take')
  expect(rtOf(took).revision).toBe(2)
  expect(rtOf(took).lamp.holder_user_id).toBeTruthy()

  expect((await act(j, 2, { action: 'power', on: false })).payload.code).toBe('OBJECT_BUSY')
  expect((await act(j, 2, { action: 'aim', yaw: 0.4, head_pitch: 0.2 })).payload.code).toBe('OBJECT_BUSY')
  expect((await act(j, 2, { action: 'take' })).payload.code).toBe('OBJECT_BUSY')

  const b = slotPos(j, 'b')
  await walkTo(j, b.x, b.z + 1)
  const placed = await act(j, 2, { action: 'place', slot_id: 'b' })
  expect(placed.type).toBe('object.acted')
  expect(rtOf(placed)).toMatchObject({ revision: 3, lamp: { slot_id: 'b', holder_user_id: null } })
})

test('aim и power меняют лампу на слоте; значения вне пределов и лишние поля — VALIDATION_ERROR', async () => {
  const j = await nearLamp()
  const aimed = await act(j, 1, { action: 'aim', yaw: 0.4, head_pitch: 0.2 })
  expect(rtOf(aimed)).toMatchObject({ revision: 2, lamp: { yaw: 0.4, head_pitch: 0.2 } })
  const off = await act(j, 2, { action: 'power', on: false })
  expect(rtOf(off)).toMatchObject({ revision: 3, lamp: { on: false } })
  expect((await act(j, 3, { action: 'aim', yaw: 0, head_pitch: 1.2 })).payload.code).toBe('VALIDATION_ERROR')
  expect((await act(j, 3, { action: 'aim', yaw: Math.PI, head_pitch: 0 })).payload.code).toBe('VALIDATION_ERROR')
  expect((await act(j, 3, { action: 'take', on: true })).payload.code).toBe('VALIDATION_ERROR')
  expect((await act(j, 3, { action: 'place' })).payload.code).toBe('VALIDATION_ERROR')
})

test('устаревшая ревизия — REVISION_CONFLICT, чужой объект — NOT_FOUND, чужой epoch — STALE_MOVEMENT_EPOCH', async () => {
  const j = await nearLamp()
  expect((await act(j, 7, { action: 'power', on: false })).payload.code).toBe('REVISION_CONFLICT')
  const other = await call(j, 'object.act', { object_id: 'lamp_02', movement_epoch: j.epoch, expected_revision: 1, action: 'take' })
  expect(other.payload.code).toBe('NOT_FOUND')
  const stale = await call(j, 'object.act', { object_id: 'lamp_01', movement_epoch: j.epoch + 1, expected_revision: 1, action: 'take' })
  expect(stale.payload.code).toBe('STALE_MOVEMENT_EPOCH')
})

test('чужой держатель лампы: take, place и power — OBJECT_BUSY', async () => {
  const j = await nearLamp()
  j.server.patchRuntime({ lamp: { holder_user_id: 'usr_other' } })
  await tick()
  const rev = (j.inbox.filter((e) => e.type === 'world.runtime').at(-1)!.payload as unknown as Rt).revision
  for (const extra of [{ action: 'take' }, { action: 'place', slot_id: 'a' }, { action: 'power', on: false }]) {
    expect((await act(j, rev, extra)).payload.code).toBe('OBJECT_BUSY')
  }
})

test('object.act: не больше 10 за 10 с, потом RATE_LIMITED', async () => {
  const j = await nearLamp()
  let rev = 1
  for (let i = 0; i < 10; i++) {
    const r = await act(j, rev, { action: 'power', on: i % 2 === 1 })
    expect(r.type).toBe('object.acted')
    rev = rtOf(r).revision
  }
  const limited = await act(j, rev, { action: 'power', on: true })
  expect(limited.payload.code).toBe('RATE_LIMITED')
  expect(limited.payload.retry_after_ms).toBeGreaterThan(0)
})

test('разрыв соединения возвращает лампу на слот: после повторного входа держателя нет', async () => {
  const j = await nearLamp()
  expect((await act(j, 1, { action: 'take' })).type).toBe('object.acted')
  j.ws.close()
  await tick()
  const again = await j.join()
  const rt = again.inbox.find((e) => e.type === 'world.runtime')!.payload as unknown as Rt
  expect(rt.lamp.holder_user_id).toBeNull()
  expect(rt.revision).toBe(3) // take и возврат на слот
})

test('guide.action: фразы таблицы §6 нормализуются, ответ с request_id, revision растёт даже при повторе', async () => {
  const j = await nearGuide()
  const shown = await ask(j, 1, '  Покажи   МАКЕТ!  ')
  expect(shown.type).toBe('guide.action.completed')
  expect(shown.payload.effect).toBe('show_installation')
  expect(rtOf(shown)).toMatchObject({ revision: 2, config: { installation_visible: true } })
  const warm = await ask(j, 2, 'тёплый свет')
  expect(rtOf(warm)).toMatchObject({ revision: 3, config: { lighting: 'warm' } })
  const again = await ask(j, 3, 'сделай освещение теплее.')
  expect(rtOf(again).revision).toBe(4)
})

test('guide.action: неизвестная фраза — UNSUPPORTED_ACTION, мир не меняется', async () => {
  const j = await nearGuide()
  const r = await ask(j, 1, 'сделай красиво')
  expect(r.type).toBe('error')
  expect(r.payload.code).toBe('UNSUPPORTED_ACTION')
  expect((await call(j, 'room.sync', {})).payload.revision).toBe(1)
})

test('guide.action: пустой текст и 201 символ — VALIDATION_ERROR; дистанция и ревизия проверяются', async () => {
  const j = await joined()
  expect((await ask(j, 1, 'а'.repeat(201))).payload.code).toBe('VALIDATION_ERROR')
  expect((await ask(j, 1, '   ')).payload.code).toBe('VALIDATION_ERROR')
  expect((await ask(j, 1, 'покажи макет')).payload.code).toBe('OUT_OF_RANGE')
  const g = j.first.guides[0].position
  await walkTo(j, g.x, g.z + 1.5)
  expect((await ask(j, 5, 'покажи макет')).payload.code).toBe('REVISION_CONFLICT')
})

test('guide.action: не больше 3 за 10 с', async () => {
  const j = await nearGuide()
  let rev = 1
  for (let i = 0; i < 3; i++) rev = rtOf(await ask(j, rev, 'покажи макет')).revision
  expect((await ask(j, rev, 'покажи макет')).payload.code).toBe('RATE_LIMITED')
})
