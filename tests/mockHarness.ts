// Мок сервера в bun: окружение браузера в минимальном объёме, мир с картинками-заглушками и ручные часы.
const g = globalThis as Record<string, unknown>
g.window ??= globalThis
// Другой тестовый файл мог подменить window голым EventTarget: моку нужны fetch и WebSocket.
const w = g.window as Record<string, unknown>
w.fetch ??= globalThis.fetch.bind(globalThis)
w.WebSocket ??= globalThis.WebSocket
g.location ??= { origin: 'http://localhost', href: 'http://localhost/' }
g.CloseEvent ??= class extends Event {
  readonly code: number
  readonly wasClean: boolean
  constructor(type: string, init: { code?: number; wasClean?: boolean } = {}) {
    super(type)
    this.code = init.code ?? 1000
    this.wasClean = init.wasClean ?? false
  }
}

const { createMockServer } = await import('../src/network/mock/server')
const { buildWorld } = await import('../src/network/mock/world')

export type Env = { type: string; request_id?: string; payload: Record<string, unknown> }

export const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms))

export async function mockServer(storage: Storage | null = null) {
  const world = await buildWorld(async () => new Blob([new Uint8Array(2048)], { type: 'image/jpeg' }))
  let t = 1000
  const server = createMockServer(world, storage, { now: () => t })
  const clock = { advance: (ms: number) => (t += ms) }

  async function http(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', ...headers } }
    if (body !== undefined) init.body = JSON.stringify(body)
    return server.fetch(`http://localhost/api/v1${path}`, init)
  }

  async function register(username = 'alice', password = 'password1') {
    const res = await http('POST', '/auth/register', { username, display_name: username, password })
    if (res.status !== 201) throw new Error(`register ${res.status}`)
  }

  /** Открывает WS, ждёт snapshot и подтверждает world.ready. */
  async function join() {
    const ws = new server.WebSocket('ws://localhost/api/v1/ws')
    const inbox: Env[] = []
    const closes: number[] = []
    ws.onmessage = (e: MessageEvent) => inbox.push(JSON.parse(String(e.data)))
    ws.onclose = (e: CloseEvent) => closes.push(e.code)
    let guard = 0
    while (!inbox.some((m) => m.type === 'world.snapshot') && guard++ < 50) await tick()
    const snapshot = inbox.find((m) => m.type === 'world.snapshot')!.payload as {
      self: { position: { x: number; z: number }; movement_epoch: number; room_id: string }
    }
    const send = (type: string, payload: unknown, request_id: string | undefined = crypto.randomUUID()) =>
      ws.send(JSON.stringify(type === 'player.move' ? { type, payload } : { type, request_id, payload }))
    send('world.ready', { world_version: 'mock-1', movement_epoch: snapshot.self.movement_epoch })
    await tick()
    const lastSelf = () => {
      const st = [...inbox].reverse().find((m) => m.type === 'players.state')
      return (st?.payload.players as Array<{ user_id: string; position: { x: number; z: number }; ack_seq: number }> | undefined)?.[0]
    }
    return { ws, inbox, closes, send, snapshot, lastSelf }
  }

  return { server, world, clock, http, register, join }
}
