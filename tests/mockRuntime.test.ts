import { expect, test } from 'bun:test'
import { mockServer, tick, type Env } from './mockHarness'

async function joined() {
  const m = await mockServer()
  await m.register()
  const j = await m.join()
  return { ...m, ...j }
}

const runtimes = (inbox: Env[]) => inbox.filter((e) => e.type === 'world.runtime')

test('манифест объявляет sunday_v1', async () => {
  const m = await mockServer()
  await m.register()
  const res = await m.http('GET', '/world/manifest')
  expect(((await res.json()) as { extensions?: string[] }).extensions).toEqual(['sunday_v1'])
})

test('world.runtime идёт сразу за snapshot и описывает текущий зал по умолчанию из api-sunday.md', async () => {
  const j = await joined()
  expect(j.inbox.map((e) => e.type).slice(0, 2)).toEqual(['world.snapshot', 'world.runtime'])
  const rt = runtimes(j.inbox)[0].payload as Record<string, any>
  expect(rt.room_id).toBe(j.snapshot.self.room_id)
  expect(rt.revision).toBe(1)
  expect(rt.config).toMatchObject({ accent_color: '#D9D2C3', lighting: 'neutral', npc_count: 10, installation_visible: false })
  expect(rt.config.lamp_slots.map((s: { slot_id: string }) => s.slot_id)).toEqual(['a', 'b'])
  expect(rt.lamp).toEqual({ object_id: 'lamp_01', slot_id: 'a', holder_user_id: null, yaw: 0, head_pitch: 0, on: true })
  expect(rt.guides.map((g: { guide_id: string }) => g.guide_id)).toEqual(['guide_leonardo'])
  expect(rt.config.guide_placements).toHaveLength(rt.guides.length)
})

test('room.sync: полный снимок с request_id запроса; без ready тоже можно', async () => {
  const m = await mockServer()
  await m.register()
  const ws = new m.server.WebSocket('ws://localhost/api/v1/ws')
  const inbox: Env[] = []
  ws.onmessage = (e: MessageEvent) => inbox.push(JSON.parse(String(e.data)))
  while (!inbox.some((e) => e.type === 'world.snapshot')) await tick()
  const rid = crypto.randomUUID()
  ws.send(JSON.stringify({ type: 'room.sync', request_id: rid, payload: {} }))
  await tick()
  const reply = inbox.find((e) => e.request_id === rid)
  expect(reply?.type).toBe('world.runtime')
  expect(reply?.payload.revision).toBe(1)
})

test('room.sync: не больше двух за 10 с, потом RATE_LIMITED, затем снова можно', async () => {
  const j = await joined()
  const ask = async () => {
    const rid = crypto.randomUUID()
    j.send('room.sync', {}, rid)
    await tick()
    return j.inbox.find((e) => e.request_id === rid)!
  }
  expect((await ask()).type).toBe('world.runtime')
  expect((await ask()).type).toBe('world.runtime')
  const limited = await ask()
  expect(limited.type).toBe('error')
  expect(limited.payload.code).toBe('RATE_LIMITED')
  expect(limited.payload.retry_after_ms).toBeGreaterThan(0)
  j.clock.advance(10_001)
  expect((await ask()).type).toBe('world.runtime')
})

test('room.sync с лишними полями — VALIDATION_ERROR', async () => {
  const j = await joined()
  const rid = crypto.randomUUID()
  j.send('room.sync', { extra: 1 }, rid)
  await tick()
  expect(j.inbox.find((e) => e.request_id === rid)?.payload.code).toBe('VALIDATION_ERROR')
})

test('после world.entered приходит runtime нового зала', async () => {
  const j = await joined()
  const epoch = j.snapshot.self.movement_epoch
  let seq = 0
  let z = j.snapshot.self.position.z
  while (z < 7.3) {
    z = Math.min(7.3, z + 0.3)
    j.clock.advance(100)
    j.send('player.move', { movement_epoch: epoch, seq: ++seq, position: { x: 0, y: 0, z }, rotation: { yaw: 0, pitch: 0 } })
  }
  const rid = crypto.randomUUID()
  j.send('world.enter', { door_id: 'door_antiquity_to_medieval', movement_epoch: epoch }, rid)
  await tick(30)
  const types = j.inbox.map((e) => e.type)
  const entered = types.lastIndexOf('world.entered')
  expect(entered).toBeGreaterThan(-1)
  const after = j.inbox[entered + 1]
  expect(after.type).toBe('world.runtime')
  expect(after.payload.room_id).toBe('hall_medieval')
  expect(after.payload.guides).toHaveLength(2)
})
