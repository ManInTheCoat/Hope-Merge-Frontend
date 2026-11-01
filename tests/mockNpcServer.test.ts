import { expect, test } from 'bun:test'
import { mockServer, tick, type Env } from './mockHarness'

type Npc = { npc_id: string; position: { x: number; z: number }; state: string; yaw: number }
type NpcState = { room_id: string; room_instance_id: string; seq: number; npcs: Npc[] }

async function joined() {
  const m = await mockServer()
  await m.register()
  const j = await m.join()
  return { ...m, ...j }
}

const npcStates = (inbox: Env[]) => inbox.filter((e) => e.type === 'npc.state')
const payload = (e: Env) => e.payload as unknown as NpcState

test('после snapshot и world.runtime приходит npc.state с 10 NPC, seq = 1', async () => {
  const j = await joined()
  expect(j.inbox.map((e) => e.type).slice(0, 3)).toEqual(['world.snapshot', 'world.runtime', 'npc.state'])
  const first = payload(npcStates(j.inbox)[0])
  expect(first.seq).toBe(1)
  expect(first.npcs).toHaveLength(10)
  expect(first.room_id).toBe(j.snapshot.self.room_id)
  j.ws.close()
})

test('каждые ~200 мс приходит новый снимок, seq растёт', async () => {
  const j = await joined()
  const before = npcStates(j.inbox).length
  await tick(520)
  const list = npcStates(j.inbox).map(payload)
  expect(list.length).toBeGreaterThanOrEqual(before + 2)
  list.forEach((s, i) => i > 0 && expect(s.seq).toBe(list[i - 1].seq + 1))
  j.ws.close()
})

test('новое соединение создаёт симуляцию заново: другая room_instance_id и seq с 1', async () => {
  const m = await mockServer()
  await m.register()
  const a = await m.join()
  const b = await m.join()
  const ia = payload(npcStates(a.inbox)[0]).room_instance_id
  const first = payload(npcStates(b.inbox)[0])
  expect(first.room_instance_id).not.toBe(ia)
  expect(first.seq).toBe(1)
  b.ws.close()
})

test('chat.send с текстом переводит NPC в радиусе 3 м в talking; без чата никто не говорит', async () => {
  const quiet = await joined()
  await tick(450)
  expect(npcStates(quiet.inbox).some((e) => payload(e).npcs.some((n) => n.state === 'talking'))).toBe(false)
  quiet.ws.close()

  const j = await joined()
  j.send('chat.send', { text: 'Здравствуйте' })
  await tick(450)
  const me = j.snapshot.self.position
  const near = payload(npcStates(j.inbox)[0]).npcs.filter((n) => Math.hypot(n.position.x - me.x, n.position.z - me.z) <= 3).length
  const talked = npcStates(j.inbox).some((e) => payload(e).npcs.some((n) => n.state === 'talking'))
  expect(talked).toBe(near > 0)
  j.ws.close()
})

test('room.sync: npc.state идёт сразу после world.runtime и несёт request_id', async () => {
  const j = await joined()
  const rid = crypto.randomUUID()
  j.send('room.sync', {}, rid)
  await tick(30)
  const idx = j.inbox.findIndex((e) => e.request_id === rid && e.type === 'world.runtime')
  expect(idx).toBeGreaterThan(-1)
  expect(j.inbox[idx + 1].type).toBe('npc.state')
  expect(j.inbox[idx + 1].request_id).toBe(rid)
  j.ws.close()
})

test('npc_count = 0 в runtime: следующий снимок пуст', async () => {
  const j = await joined()
  j.server.patchRuntime({ config: { npc_count: 0 } })
  await tick(30)
  const last = payload(npcStates(j.inbox).at(-1)!)
  expect(last.npcs).toEqual([])
  j.ws.close()
})

test('после закрытия сокета таймер не шлёт', async () => {
  const j = await joined()
  j.ws.close()
  await tick(30)
  const n = npcStates(j.inbox).length
  await tick(450)
  expect(npcStates(j.inbox).length).toBe(n)
})
