import {
  WS_PATH,
  type ClientEvents,
  type ClientEventType,
  type ErrorBody,
  type ServerEnvelope,
  type ServerEventType,
  type ServerEvents,
} from './contract'

type Handler = (payload: never, env: never) => void

export class GameSocket {
  private handlers = new Map<string, Set<Handler>>()
  private closeHandlers = new Set<(code: number) => void>()
  private closed = false

  private readonly ws: WebSocket

  private constructor(ws: WebSocket) {
    this.ws = ws
  }

  static open(
    url: string = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${WS_PATH}`,
    Ctor: typeof WebSocket = WebSocket,
  ): Promise<{ socket: GameSocket; snapshot: ServerEvents['world.snapshot'] }> {
    return new Promise((resolve, reject) => {
      const ws = new Ctor(url)
      const socket = new GameSocket(ws)
      let settled = false

      socket.on('world.snapshot', (snapshot) => {
        settled = true
        resolve({ socket, snapshot })
      })
      socket.onClose((code) => {
        if (!settled) reject(new Error(`SOCKET_CLOSED:${code}`))
      })

      ws.onmessage = (ev) => socket.receive(String(ev.data))
      ws.onclose = (ev) => socket.handleClose(ev.code)
      ws.onerror = () => {} // подробности придут в onclose
    })
  }

  get isOpen(): boolean {
    return !this.closed && this.ws.readyState === 1
  }

  on<K extends ServerEventType>(
    type: K,
    handler: (payload: ServerEvents[K], env: ServerEnvelope<K>) => void,
  ): () => void {
    let set = this.handlers.get(type)
    if (!set) this.handlers.set(type, (set = new Set()))
    set.add(handler as unknown as Handler)
    return () => set.delete(handler as unknown as Handler)
  }

  onClose(handler: (code: number) => void): () => void {
    this.closeHandlers.add(handler)
    return () => this.closeHandlers.delete(handler)
  }

  /** Возвращает request_id отправленной команды; null, если сокет закрыт или команда без request_id (`player.move`). */
  send<K extends ClientEventType>(type: K, payload: ClientEvents[K]): string | null {
    if (!this.isOpen) return null
    const request_id = type === 'player.move' ? undefined : crypto.randomUUID()
    this.ws.send(JSON.stringify({ type, ...(request_id ? { request_id } : {}), payload }))
    return request_id ?? null
  }

  request<K extends Exclude<ClientEventType, 'player.move'>, R extends ServerEventType>(
    type: K,
    payload: ClientEvents[K],
    response: R,
  ): Promise<ServerEvents[R]> {
    return new Promise((resolve, reject) => {
      const offs: Array<() => void> = []
      const cleanup = () => offs.forEach((off) => off())
      const request_id = this.send(type, payload)
      if (!request_id) return reject(new Error('SOCKET_CLOSED'))

      offs.push(
        this.on(response, (p, env) => {
          if (env.request_id !== request_id) return
          cleanup()
          resolve(p)
        }),
        this.on('error', (body: ErrorBody, env) => {
          if (env.request_id !== request_id) return
          cleanup()
          reject(body)
        }),
        this.onClose(() => {
          cleanup()
          reject(new Error('SOCKET_CLOSED'))
        }),
      )
    })
  }

  close(): void {
    this.ws.close()
  }

  private receive(data: string): void {
    let env: ServerEnvelope
    try {
      env = JSON.parse(data)
    } catch {
      return
    }
    this.handlers.get(env.type)?.forEach((h) => (h as (p: unknown, e: unknown) => void)(env.payload, env))
  }

  private handleClose(code: number): void {
    if (this.closed) return
    this.closed = true
    this.closeHandlers.forEach((h) => h(code))
  }
}
