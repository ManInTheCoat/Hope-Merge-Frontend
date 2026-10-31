import {
  WS_PATH,
  type ClientEvents,
  type ClientEventType,
  type ErrorBody,
  type ServerEnvelope,
  type ServerEventType,
  type ServerEvents,
} from './contract'
import { uuidV4 } from './uuid'

const SNAPSHOT_TIMEOUT_MS = 15_000
/** Сколько последних event_id помним для отбрасывания повторов. */
const SEEN_EVENTS_LIMIT = 1000

type Handler = (payload: never, env: never) => void

export class GameSocket {
  private handlers = new Map<string, Set<Handler>>()
  private closeHandlers = new Set<(code: number) => void>()
  private closed = false
  private seenEvents = new Set<string>()

  private readonly ws: WebSocket

  private constructor(ws: WebSocket) {
    this.ws = ws
  }

  static open(
    url: string = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${WS_PATH}`,
    Ctor: typeof WebSocket = WebSocket,
    timeoutMs: number = SNAPSHOT_TIMEOUT_MS,
  ): Promise<{ socket: GameSocket; snapshot: ServerEvents['world.snapshot'] }> {
    return new Promise((resolve, reject) => {
      const ws = new Ctor(url)
      const socket = new GameSocket(ws)
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        reject(new Error('SNAPSHOT_TIMEOUT'))
        socket.close()
      }, timeoutMs)

      socket.on('world.snapshot', (snapshot) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ socket, snapshot })
      })
      socket.onClose((code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new Error(`SOCKET_CLOSED:${code}`))
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
    const request_id = type === 'player.move' ? undefined : uuidV4()
    this.ws.send(JSON.stringify({ type, ...(request_id ? { request_id } : {}), payload }))
    return request_id ?? null
  }

  request<K extends Exclude<ClientEventType, 'player.move'>, R extends ServerEventType>(
    type: K,
    payload: ClientEvents[K],
    response: R,
    /** Без ответа за это время промис отклоняется с REQUEST_TIMEOUT; не задан — ждём до закрытия сокета. */
    timeoutMs?: number,
  ): Promise<ServerEvents[R]> {
    return new Promise((resolve, reject) => {
      const offs: Array<() => void> = []
      const cleanup = () => offs.forEach((off) => off())
      const request_id = this.send(type, payload)
      if (!request_id) return reject(new Error('SOCKET_CLOSED'))
      if (timeoutMs !== undefined) {
        const timer = setTimeout(() => {
          cleanup()
          reject(new Error('REQUEST_TIMEOUT'))
        }, timeoutMs)
        offs.push(() => clearTimeout(timer))
      }

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

  /** Штатное закрытие (1000): сервер сохраняет позицию при штатном отключении. */
  close(): void {
    this.ws.close(1000)
  }

  private receive(data: string): void {
    let env: ServerEnvelope
    try {
      env = JSON.parse(data)
    } catch {
      console.warn('Нечитаемое сообщение WS')
      return
    }
    if (typeof env?.type !== 'string') {
      console.warn('Сообщение WS без type')
      return
    }
    if (typeof env.event_id === 'string') {
      if (this.seenEvents.has(env.event_id)) return
      this.seenEvents.add(env.event_id)
      if (this.seenEvents.size > SEEN_EVENTS_LIMIT) {
        this.seenEvents.delete(this.seenEvents.values().next().value!)
      }
    }
    const handlers = this.handlers.get(env.type)
    if (!handlers?.size) {
      console.warn('Неизвестное событие WS:', env.type)
      return
    }
    handlers.forEach((h) => (h as (p: unknown, e: unknown) => void)(env.payload, env))
  }

  private handleClose(code: number): void {
    if (this.closed) return
    this.closed = true
    this.closeHandlers.forEach((h) => h(code))
  }
}
