import { expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { SERVER_EVENT_TYPES } from '../src/network/contract'
import { GameSocket } from '../src/network/ws'

const DIR = join(import.meta.dir, 'fixtures', 'sunday')
const fixture = (name: string) => JSON.parse(readFileSync(join(DIR, name), 'utf8'))

class FakeWebSocket {
  static last: FakeWebSocket
  readyState = 1
  sent: string[] = []
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: ((ev: { code: number }) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  constructor(public url: string) {
    FakeWebSocket.last = this
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {}
}
const Ctor = FakeWebSocket as unknown as typeof WebSocket
const snapshot = { protocol_version: 1, world_version: 'v1', self: {}, players: [], current_room: {} }

async function opened() {
  const p = GameSocket.open('ws://x/ws', Ctor)
  const fake = FakeWebSocket.last
  fake.onmessage?.({ data: JSON.stringify({ type: 'world.snapshot', event_id: 's', server_time: 't', payload: snapshot }) })
  const { socket } = await p
  return { socket, fake }
}

const SERVER_FIXTURES = ['world.runtime', 'npc.state', 'object.acted', 'guide.action.completed', 'telemetry.probe']

test('серверные события Sunday известны клиенту', () => {
  for (const t of SERVER_FIXTURES) expect(SERVER_EVENT_TYPES.has(t)).toBe(true)
})

test('fixtures серверных событий доходят до обработчиков с payload', async () => {
  const { socket, fake } = await opened()
  const got: Record<string, unknown> = {}
  const warn = console.warn
  const warned: unknown[] = []
  console.warn = (...a) => void warned.push(a)
  try {
    for (const t of SERVER_FIXTURES) {
      socket.on(t as 'world.runtime', (p) => void (got[t] = p))
      fake.onmessage?.({ data: readFileSync(join(DIR, `${t}.json`), 'utf8') })
    }
  } finally {
    console.warn = warn
  }
  expect(warned).toEqual([])
  for (const t of SERVER_FIXTURES) expect(got[t]).toEqual(fixture(`${t}.json`).payload)
})

test('client.metrics и telemetry.pong уходят без request_id', async () => {
  const { socket, fake } = await opened()
  expect(socket.send('client.metrics', fixture('client.metrics.json').payload)).toBeNull()
  expect(socket.send('telemetry.pong', fixture('telemetry.pong.json').payload)).toBeNull()
  for (const raw of fake.sent) expect(JSON.parse(raw).request_id).toBeUndefined()
  expect(JSON.parse(fake.sent[0])).toEqual(fixture('client.metrics.json'))
})

test('object.act, guide.action и room.sync получают request_id', async () => {
  const { socket, fake } = await opened()
  const act = fixture('object.act.take.json').payload
  expect(socket.send('object.act', act)).not.toBeNull()
  expect(socket.send('room.sync', {})).not.toBeNull()
  for (const raw of fake.sent) expect(JSON.parse(raw).request_id).toBeTruthy()
})

test('fixtures клиентских команд покрывают все клиентские типы', () => {
  const names = readdirSync(DIR)
  for (const n of ['room.sync', 'object.act.take', 'guide.action', 'client.metrics', 'telemetry.pong']) {
    expect(names).toContain(`${n}.json`)
  }
})
