import { expect, spyOn, test } from 'bun:test'
import { GameSocket } from '../src/network/ws'

class FakeWebSocket {
  static last: FakeWebSocket
  readyState = 1
  sent: string[] = []
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: ((ev: { code: number }) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  constructor(public url: string) {
    FakeWebSocket.last = this
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.serverClose(1000)
  }
  serverSend(type: string, payload: unknown, request_id?: string, event_id: string = crypto.randomUUID()) {
    const env = { type, event_id, server_time: 't', ...(request_id ? { request_id } : {}), payload }
    this.onmessage?.({ data: JSON.stringify(env) })
  }
  serverClose(code: number) {
    this.readyState = 3
    this.onclose?.({ code })
  }
}

const Ctor = FakeWebSocket as unknown as typeof WebSocket
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const snapshot = { protocol_version: 1, world_version: 'v1', self: {}, players: [], current_room: {} }

async function opened() {
  const p = GameSocket.open('ws://x/ws', Ctor)
  const fake = FakeWebSocket.last
  fake.serverSend('world.snapshot', snapshot)
  const { socket } = await p
  return { socket, fake }
}

test('open ждёт world.snapshot и возвращает его payload', async () => {
  const p = GameSocket.open('ws://x/ws', Ctor)
  FakeWebSocket.last.serverSend('world.snapshot', snapshot)
  const res = await p
  expect(res.snapshot.world_version).toBe('v1')
})

test('open отклоняется, если сокет закрылся до snapshot', async () => {
  const p = GameSocket.open('ws://x/ws', Ctor)
  FakeWebSocket.last.serverClose(1011)
  await expect(p).rejects.toThrow()
})

test('player.move уходит без request_id', async () => {
  const { socket, fake } = await opened()
  const id = socket.send('player.move', {
    movement_epoch: 1,
    seq: 1,
    position: { x: 0, y: 0, z: 0 },
    rotation: { yaw: 0, pitch: 0 },
  })
  expect(id).toBeNull()
  const msg = JSON.parse(fake.sent[0])
  expect(msg.type).toBe('player.move')
  expect(msg.request_id).toBeUndefined()
})

test('остальные команды получают UUID v4 request_id', async () => {
  const { socket, fake } = await opened()
  const id = socket.send('exhibit.inspect', { exhibit_id: 'e1' })
  const msg = JSON.parse(fake.sent[0])
  expect(msg.request_id).toMatch(UUID_V4)
  expect(msg.request_id).toBe(id)
})

test('request резолвится по совпадению request_id', async () => {
  const { socket, fake } = await opened()
  const p = socket.request('exhibit.inspect', { exhibit_id: 'e1' }, 'exhibit.inspected')
  const rid = JSON.parse(fake.sent[0]).request_id
  fake.serverSend('exhibit.inspected', { exhibit_id: 'other', inspected_at: 'x' }, 'not-it')
  fake.serverSend('exhibit.inspected', { exhibit_id: 'e1', inspected_at: 'x' }, rid)
  expect((await p).exhibit_id).toBe('e1')
})

test('request отклоняется ErrorBody из события error', async () => {
  const { socket, fake } = await opened()
  const p = socket.request('exhibit.inspect', { exhibit_id: 'e1' }, 'exhibit.inspected')
  const rid = JSON.parse(fake.sent[0]).request_id
  fake.serverSend('error', { code: 'OUT_OF_RANGE', message: 'Слишком далеко' }, rid)
  await expect(p).rejects.toMatchObject({ code: 'OUT_OF_RANGE' })
})

test('request отклоняется при закрытии сокета, а не висит', async () => {
  const { socket, fake } = await opened()
  const p = socket.request('exhibit.inspect', { exhibit_id: 'e1' }, 'exhibit.inspected')
  fake.serverClose(1011)
  await expect(p).rejects.toThrow('SOCKET_CLOSED')
})

test('send после закрытия возвращает null', async () => {
  const { socket, fake } = await opened()
  fake.serverClose(1011)
  expect(socket.send('exhibit.inspect', { exhibit_id: 'e1' })).toBeNull()
  expect(socket.isOpen).toBe(false)
})

test('open отклоняется по тайм-ауту, если snapshot не пришёл', async () => {
  const p = GameSocket.open('ws://x/ws', Ctor, 30)
  const fake = FakeWebSocket.last
  await expect(p).rejects.toThrow('SNAPSHOT_TIMEOUT')
  expect(fake.readyState).toBe(3)
})

test('событие с уже виденным event_id не доставляется повторно', async () => {
  const { socket, fake } = await opened()
  let n = 0
  socket.on('player.left', () => n++)
  fake.serverSend('player.left', { user_id: 'u' }, undefined, 'dup')
  fake.serverSend('player.left', { user_id: 'u' }, undefined, 'dup')
  expect(n).toBe(1)
})

test('неизвестный тип и битый JSON не роняют сокет и пишут предупреждение', async () => {
  const { socket, fake } = await opened()
  const warn = spyOn(console, 'warn').mockImplementation(() => {})
  fake.serverSend('world.rooms_available', {})
  fake.onmessage?.({ data: '{not json' })
  expect(warn).toHaveBeenCalledTimes(2)
  expect(socket.isOpen).toBe(true)
  warn.mockRestore()
})
