import { expect, test } from 'bun:test'
import { mockServer, tick } from './mockHarness'

async function joined() {
  const m = await mockServer()
  await m.register()
  const j = await m.join()
  return { ...m, ...j }
}

/** Ждёт ближайший players.state (мок рассылает их раз в 100 мс реального времени). */
async function freshState(j: Awaited<ReturnType<typeof joined>>) {
  const before = j.inbox.length
  let guard = 0
  while (!j.inbox.slice(before).some((e) => e.type === 'players.state') && guard++ < 60) await tick()
  return j.lastSelf()!
}

test('первым приходит world.snapshot', async () => {
  const j = await joined()
  expect(j.inbox[0].type).toBe('world.snapshot')
})

test('player.move до world.ready не меняет позицию', async () => {
  const m = await mockServer()
  await m.register()
  const ws = new m.server.WebSocket('ws://localhost/api/v1/ws')
  const inbox: Array<{ type: string; payload: Record<string, unknown> }> = []
  ws.onmessage = (e: MessageEvent) => inbox.push(JSON.parse(String(e.data)))
  await tick(60)
  const snap = inbox[0].payload as { self: { position: { x: number; z: number }; movement_epoch: number } }
  ws.send(JSON.stringify({ type: 'player.move', payload: { movement_epoch: snap.self.movement_epoch, seq: 1, position: { x: 0, y: 0, z: 4.9 }, rotation: { yaw: 0, pitch: 0 } } }))
  await tick(150)
  const st = [...inbox].reverse().find((e) => e.type === 'players.state')
  const self = (st!.payload.players as Array<{ position: { z: number } }>)[0]
  expect(self.position.z).toBe(snap.self.position.z)
})

test('будущий epoch → VALIDATION_ERROR без request_id', async () => {
  const j = await joined()
  j.send('player.move', { movement_epoch: 99, seq: 1, position: { x: 0, y: 0, z: 5 }, rotation: { yaw: 0, pitch: 0 } }, undefined)
  await tick()
  const err = j.inbox.find((e) => e.type === 'error')!
  expect(err.payload.code).toBe('VALIDATION_ERROR')
  expect(err.request_id).toBeUndefined()
})

const move = (j: Awaited<ReturnType<typeof joined>>, seq: number, x: number, z: number) =>
  j.send('player.move', { movement_epoch: j.snapshot.self.movement_epoch, seq, position: { x, y: 0, z }, rotation: { yaw: 0, pitch: 0 } }, undefined)

test('скорость: 0,5 м за 100 мс отклонено, ack_seq обновлён', async () => {
  const j = await joined()
  const { x, z } = j.snapshot.self.position
  j.clock.advance(100)
  move(j, 1, x, z - 0.5)
  const self = await freshState(j)
  expect(self.position.z).toBe(z)
  expect(self.ack_seq).toBe(1)
})

test('ходьба нашим темпом (0,36 м раз в 100 мс) не даёт ни одного отказа', async () => {
  const j = await joined()
  let { x, z } = j.snapshot.self.position
  for (let seq = 1; seq <= 30; seq++) {
    j.clock.advance(100)
    z -= 0.36
    if (z < -7) z += 0.72 // не упираемся в стену: проверяем только скорость
    move(j, seq, x, z)
  }
  const self = await freshState(j)
  expect(self.position.z).toBeCloseTo(z, 9)
  expect(self.ack_seq).toBe(30)
})

test('шаг сквозь стену отклоняется целиком', async () => {
  const j = await joined()
  const { x } = j.snapshot.self.position
  // Подходим к стене зала по +Z (полу-глубина 8) обычным шагом до z=7,6, затем шаг за стену (z=8,1).
  let z = j.snapshot.self.position.z
  let seq = 0
  while (z < 7.6) {
    z = Math.min(7.6, z + 0.3)
    j.clock.advance(100)
    move(j, ++seq, x, z)
  }
  j.clock.advance(250)
  move(j, ++seq, x, 8.1)
  const self = await freshState(j)
  expect(self.position.z).toBeCloseTo(7.6, 9)
})

test('неизвестный type → UNKNOWN_EVENT; chat.send без text → VALIDATION_ERROR без исключения', async () => {
  const j = await joined()
  const r1 = crypto.randomUUID()
  const r2 = crypto.randomUUID()
  j.send('world.rooms_available', {}, r1)
  expect(() => j.send('chat.send', {}, r2)).not.toThrow()
  await tick()
  expect(j.inbox.find((e) => e.request_id === r1)?.payload.code).toBe('UNKNOWN_EVENT')
  expect(j.inbox.find((e) => e.request_id === r2)?.payload.code).toBe('VALIDATION_ERROR')
})

test('лишнее поле в WS и HTTP отклоняется', async () => {
  const j = await joined()
  const rid = crypto.randomUUID()
  j.send('chat.send', { text: 'hi', extra: 1 }, rid)
  await tick()
  expect(j.inbox.find((e) => e.request_id === rid)?.payload.code).toBe('VALIDATION_ERROR')
  const res = await j.http('POST', '/auth/login', { username: 'alice', password: 'password1', remember: true })
  expect(res.status).toBe(400)
})

test('повторный вход закрывает WS прежней сессии', async () => {
  const j = await joined()
  const res = await j.http('POST', '/auth/login', { username: 'alice', password: 'password1' })
  expect(res.status).toBe(200)
  await tick()
  expect(j.closes).toEqual([4001])
})

test('пароль: 129 байт отклонён, 40 кириллических символов (80 байт) приняты', async () => {
  const m = await mockServer()
  const long = await m.http('POST', '/auth/register', { username: 'bob', display_name: 'Боб', password: 'x'.repeat(129) })
  expect(long.status).toBe(400)
  const cyr = await m.http('POST', '/auth/register', { username: 'bob', display_name: 'Боб', password: 'ж'.repeat(40) })
  expect(cyr.status).toBe(201)
})

test('история неизвестного гида — 404; by-request — генерация или 404', async () => {
  const j = await joined()
  expect((await j.http('GET', '/guides/nobody/generations?limit=20')).status).toBe(404)
  expect((await j.http('GET', `/guides/guide_curator/generations/by-request/${crypto.randomUUID()}`)).status).toBe(404)
  // Подходим к гиду (3, -3) с запасом по скорости и спрашиваем.
  let { x, z } = j.snapshot.self.position
  let seq = 0
  while (Math.hypot(3 - x, -3 - z) > 2) {
    const d = Math.hypot(3 - x, -3 - z)
    x += ((3 - x) / d) * 0.3
    z += ((-3 - z) / d) * 0.3
    j.clock.advance(100)
    move(j, ++seq, x, z)
  }
  const rid = crypto.randomUUID()
  j.send('guide.ask', { guide_id: 'guide_curator', text: 'Привет' }, rid)
  await tick()
  expect(j.inbox.find((e) => e.request_id === rid)?.type).toBe('guide.accepted')
  const res = await j.http('GET', `/guides/guide_curator/generations/by-request/${rid}`)
  expect(res.status).toBe(200)
  expect(((await res.json()) as { request_id: string }).request_id).toBe(rid)
})

test('guide.cancel чужой или несуществующей генерации → NOT_FOUND', async () => {
  const j = await joined()
  const rid = crypto.randomUUID()
  j.send('guide.cancel', { generation_id: 'gen_foreign' }, rid)
  await tick()
  expect(j.inbox.find((e) => e.request_id === rid)?.payload.code).toBe('NOT_FOUND')
})
