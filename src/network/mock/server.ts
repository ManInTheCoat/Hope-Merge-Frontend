import {
  API_BASE,
  CloseCode,
  PROTOCOL_VERSION,
  WS_PATH,
  type ClientEnvelope,
  type DialogMessage,
  type ErrorBody,
  type Generation,
  type Photo,
  type Player,
  type Pose,
  type ServerEnvelope,
  type ServerEventType,
  type ServerEvents,
  type User,
} from '../contract'
import { START_POSITION, START_ROOM_ID, WORLD_VERSION, type MockWorld } from './world'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const COLORS = ['#e57373', '#64b5f6', '#81c784', '#ffb74d', '#ba68c8']
const GUIDE_REPLY =
  'Здравствуйте! Этот экспонат относится к раннему периоду коллекции. Обратите внимание на композицию и цвет: ' +
  'по ним специалисты определяют время и место создания. Если хотите, расскажу и о соседних работах.'

type Account = { user: User; password: string; pose: Pose }
type Session = { account: Account }

export type MockServer = {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  WebSocket: typeof WebSocket
}

function json(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
  const h = { 'Cache-Control': 'no-store', 'X-Request-ID': crypto.randomUUID(), ...headers }
  if (status === 204 || body === undefined) return new Response(null, { status, headers: h })
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { ...h, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function httpError(status: number, code: string, message: string): Response {
  const request_id = crypto.randomUUID()
  return json(status, { error: { code, message, request_id } }, { 'X-Request-ID': request_id })
}

export function createMockServer(world: MockWorld): MockServer {
  const accounts = new Map<string, Account>()
  const photos = new Map<string, { photo: Photo; blob: Blob; owner: string }>()
  const idempotent = new Map<string, Photo>()
  const generations = new Map<string, Generation[]>()
  let session: Session | null = null
  let socket: MockSocket | null = null

  const now = () => new Date().toISOString()
  const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`

  // --- HTTP ---

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url, location.origin)
    const path = url.pathname.slice(API_BASE.length)
    const method = req.method.toUpperCase()

    if (method === 'POST' && (path === '/auth/register' || path === '/auth/login')) {
      let body: Record<string, string>
      try {
        body = await req.json()
      } catch {
        return httpError(400, 'INVALID_JSON', 'Некорректный JSON')
      }
      if (path === '/auth/register') {
        const username = String(body.username ?? '').trim().toLowerCase()
        const display_name = String(body.display_name ?? '').trim()
        const password = String(body.password ?? '')
        if (!/^[a-z0-9_]{3,32}$/.test(username) || !display_name || [...display_name].length > 32 || password.length < 8) {
          return httpError(400, 'VALIDATION_ERROR', 'Некорректные данные')
        }
        if (accounts.has(username)) return httpError(409, 'USERNAME_TAKEN', 'Имя занято')
        const user: User = {
          id: newId('user'),
          username,
          display_name,
          avatar_color: COLORS[accounts.size % COLORS.length],
        }
        const account: Account = {
          user,
          password,
          pose: { room_id: START_ROOM_ID, position: { ...START_POSITION }, rotation: { yaw: 0, pitch: 0 } },
        }
        accounts.set(username, account)
        session = { account }
        return json(201, { user })
      }
      const account = accounts.get(String(body.username ?? '').toLowerCase())
      if (!account || account.password !== body.password) {
        return httpError(401, 'INVALID_CREDENTIALS', 'Неверное имя или пароль')
      }
      session = { account }
      return json(200, { user: account.user })
    }

    if (method === 'POST' && path === '/auth/logout') {
      session = null
      socket?.serverClose(CloseCode.SessionExpired)
      return json(204)
    }

    if (!session) return httpError(401, 'UNAUTHENTICATED', 'Нужен вход')
    const { account } = session

    if (method === 'GET' && path === '/me') {
      return json(200, { user: account.user, player_state: account.pose })
    }

    if (method === 'GET' && path === '/world/manifest') return json(200, world.manifest)

    const roomMatch = path.match(/^\/world\/rooms\/([^/]+)$/)
    const assetMatch = path.match(/^\/world\/assets\/([^/]+)$/)
    if (method === 'GET' && (roomMatch || assetMatch)) {
      if (url.searchParams.get('version') !== WORLD_VERSION) {
        return httpError(409, 'WORLD_VERSION_MISMATCH', 'Версия мира не совпадает')
      }
      if (!socket) return httpError(409, 'GAME_NOT_READY', 'Нет активного игрового соединения')
      const current = world.rooms.get(account.pose.room_id)!
      if (roomMatch) {
        const id = decodeURIComponent(roomMatch[1])
        if (id !== current.room.id) return httpError(403, 'ROOM_NOT_ACCESSIBLE', 'Зал недоступен')
        return json(200, current.json)
      }
      const id = decodeURIComponent(assetMatch![1])
      const asset = world.assets.get(id)
      if (!asset || !current.pkg.assets.some((a) => a.id === id)) return httpError(404, 'NOT_FOUND', 'Нет ресурса')
      return new Response(asset.blob, {
        headers: { 'Content-Type': asset.contentType, 'Cache-Control': 'no-store' },
      })
    }

    const genMatch = path.match(/^\/guides\/([^/]+)\/generations$/)
    if (method === 'GET' && genMatch) {
      return json(200, { items: generations.get(`${account.user.id}:${genMatch[1]}`) ?? [], next_before: null })
    }

    if (method === 'POST' && path === '/photos') return createPhoto(req, account)

    if (method === 'GET' && path === '/photos') {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 6), 1), 6)
      const own = [...photos.values()].filter((p) => p.owner === account.user.id).map((p) => p.photo).reverse()
      return json(200, { items: own.slice(0, limit), next_cursor: null })
    }

    const imgMatch = path.match(/^\/photos\/([^/]+)\/(image|thumbnail)$/)
    if (method === 'GET' && imgMatch) {
      const entry = photos.get(decodeURIComponent(imgMatch[1]))
      if (!entry || (entry.owner !== account.user.id && !entry.photo.published)) {
        return httpError(404, 'NOT_FOUND', 'Фото не найдено')
      }
      return new Response(entry.blob, { headers: { 'Content-Type': entry.blob.type, 'Cache-Control': 'no-store' } })
    }

    return httpError(404, 'NOT_FOUND', 'Нет такого маршрута')
  }

  async function createPhoto(req: Request, account: Account): Promise<Response> {
    const key = req.headers.get('Idempotency-Key') ?? ''
    if (!UUID_RE.test(key)) return httpError(400, 'VALIDATION_ERROR', 'Нужен Idempotency-Key (UUID v4)')
    const existing = idempotent.get(`${account.user.id}:${key}`)
    if (existing) return json(200, existing)
    if (!socket?.ready) return httpError(409, 'GAME_NOT_READY', 'Игра не готова')

    const form = await req.formData()
    const file = form.get('image')
    if (!(file instanceof Blob) || (file.type !== 'image/jpeg' && file.type !== 'image/webp')) {
      return httpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Нужен JPEG или WebP')
    }
    if (file.size > 2 * 1024 * 1024) return httpError(413, 'PAYLOAD_TOO_LARGE', 'Файл больше 2 МиБ')
    if (Number(form.get('movement_epoch')) !== socket.epoch || form.get('room_id') !== account.pose.room_id) {
      return httpError(409, 'GAME_NOT_READY', 'Зал или epoch устарели')
    }

    const id = newId('photo')
    const exhibitId = form.get('exhibit_id')
    const photo: Photo = {
      id,
      owner_id: account.user.id,
      caption: String(form.get('caption') ?? ''),
      room_id: account.pose.room_id,
      exhibit_id: typeof exhibitId === 'string' ? exhibitId : null,
      published: false,
      image_url: `${API_BASE}/photos/${id}/image`,
      image_bytes: file.size,
      thumbnail_url: `${API_BASE}/photos/${id}/thumbnail`,
      thumbnail_bytes: file.size,
      width: 1920,
      height: 1080,
      created_at: now(),
    }
    photos.set(id, { photo, blob: file, owner: account.user.id })
    idempotent.set(`${account.user.id}:${key}`, photo)
    return json(201, photo)
  }

  // --- WebSocket ---

  class MockSocket extends EventTarget {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
    readonly CONNECTING = 0
    readonly OPEN = 1
    readonly CLOSING = 2
    readonly CLOSED = 3

    readyState = 0
    binaryType: BinaryType = 'blob'
    bufferedAmount = 0
    extensions = ''
    protocol = ''
    onopen: ((ev: Event) => void) | null = null
    onmessage: ((ev: MessageEvent) => void) | null = null
    onclose: ((ev: CloseEvent) => void) | null = null
    onerror: ((ev: Event) => void) | null = null

    ready = false
    epoch = 1
    private ackSeq = 0
    private self: Player | null = null
    private seenRequests = new Set<string>()
    private timers = new Set<ReturnType<typeof setTimeout | typeof setInterval>>()
    private stateTimer: ReturnType<typeof setInterval> | null = null
    private bot: Player

    readonly url: string

    constructor(url: string) {
      super()
      this.url = url
      const open = () => {
        const acc = session?.account
        if (!acc) return this.fail(CloseCode.SessionExpired)
        socket?.serverClose(CloseCode.Replaced)
        socket = this
        this.readyState = 1
        this.emit(new Event('open'), this.onopen)

        const pose = acc.pose
        this.self = {
          user_id: acc.user.id,
          display_name: acc.user.display_name,
          avatar_color: acc.user.avatar_color,
          room_id: pose.room_id,
          position: { ...pose.position },
          rotation: { ...pose.rotation },
          movement_epoch: this.epoch,
          ack_seq: 0,
        }
        this.send_('world.snapshot', {
          protocol_version: PROTOCOL_VERSION,
          world_version: WORLD_VERSION,
          self: this.self,
          players: [this.botPlayer()],
          current_room: world.rooms.get(pose.room_id)!.pkg,
        })
        this.stateTimer = setInterval(() => this.broadcastState(), 100)
      }
      this.later(open, 30)
      this.bot = {
        user_id: 'user_bot',
        display_name: 'Посетитель',
        avatar_color: '#4db6ac',
        room_id: START_ROOM_ID,
        position: { x: 0, y: 0, z: 0 },
        rotation: { yaw: 0, pitch: 0 },
        movement_epoch: 1,
        ack_seq: 0,
      }
    }

    // Бот ходит по кругу в первом зале.
    private botPlayer(): Player {
      const t = performance.now() / 4000
      this.bot.position = { x: Math.cos(t) * 3, y: 0, z: Math.sin(t) * 3 }
      this.bot.rotation = { yaw: -t - Math.PI / 2, pitch: 0 }
      return this.bot
    }

    private later(fn: () => void, ms: number) {
      const id = setTimeout(() => {
        this.timers.delete(id)
        fn()
      }, ms)
      this.timers.add(id)
    }

    private emit<T extends Event>(ev: T, handler: ((ev: T) => void) | null) {
      handler?.call(this, ev)
      this.dispatchEvent(ev)
    }

    private send_<K extends ServerEventType>(type: K, payload: ServerEvents[K], request_id?: string) {
      if (this.readyState !== 1) return
      const env = {
        type,
        event_id: crypto.randomUUID(),
        server_time: now(),
        ...(request_id ? { request_id } : {}),
        payload,
      } as ServerEnvelope
      this.later(() => {
        if (this.readyState !== 1) return
        this.emit(new MessageEvent('message', { data: JSON.stringify(env) }), this.onmessage)
      }, 0)
    }

    private error(code: string, message: string, request_id?: string, extra: Partial<ErrorBody> = {}) {
      this.send_('error', { code, message, ...extra }, request_id)
    }

    private broadcastState() {
      if (!this.self) return
      const players = [this.self]
      if (this.self.room_id === this.bot.room_id) players.push(this.botPlayer())
      this.send_('players.state', { players })
    }

    private fail(code: number) {
      this.later(() => this.serverClose(code), 0)
    }

    serverClose(code: number) {
      if (this.readyState === 3) return
      this.readyState = 3
      this.ready = false
      if (this.stateTimer) clearInterval(this.stateTimer)
      this.timers.forEach((t) => clearTimeout(t))
      this.timers.clear()
      if (socket === this) socket = null
      this.emit(new CloseEvent('close', { code, wasClean: code === 1000 }), this.onclose)
    }

    close(code = 1000) {
      this.serverClose(code)
    }

    send(data: string) {
      if (this.readyState !== 1 || !this.self || !session) return
      if (typeof data !== 'string') return this.serverClose(CloseCode.UnsupportedData)
      let msg: ClientEnvelope
      try {
        msg = JSON.parse(data)
      } catch {
        return this.error('INVALID_JSON', 'Некорректный JSON')
      }
      this.dispatch(msg)
    }

    private dispatch(msg: ClientEnvelope) {
      const rid = msg.request_id
      if (msg.type !== 'player.move') {
        if (!rid || !UUID_RE.test(rid)) return this.error('VALIDATION_ERROR', 'Нужен request_id (UUID v4)', rid)
        if (this.seenRequests.has(rid)) return this.error('DUPLICATE_REQUEST', 'Повторный request_id', rid)
        this.seenRequests.add(rid)
      }
      const self = this.self!
      const acc = session!.account

      switch (msg.type) {
        case 'world.ready': {
          const p = msg.payload
          if (p.world_version !== WORLD_VERSION || p.movement_epoch !== this.epoch) {
            return this.error('STALE_MOVEMENT_EPOCH', 'Неактуальные версия или epoch', rid)
          }
          this.ready = true
          return this.send_('world.ready', { movement_epoch: this.epoch }, rid)
        }
        case 'player.move': {
          const p = msg.payload
          if (!this.ready || p.movement_epoch !== this.epoch || p.seq <= this.ackSeq) return
          this.ackSeq = p.seq
          self.ack_seq = p.seq
          self.position = { x: p.position.x, y: 0, z: p.position.z }
          self.rotation = p.rotation
          acc.pose = { room_id: self.room_id, position: self.position, rotation: self.rotation }
          return
        }
        case 'world.enter': {
          if (!this.ready) return this.error('GAME_NOT_READY', 'Игра не готова', rid)
          if (msg.payload.movement_epoch !== this.epoch) return this.error('STALE_MOVEMENT_EPOCH', 'Неактуальный epoch', rid)
          const room = world.rooms.get(self.room_id)!.room
          const door = room.doors.find((d) => d.id === msg.payload.door_id)
          if (!door) return this.error('NOT_FOUND', 'Нет такой двери', rid)
          const dist = Math.hypot(door.position.x - self.position.x, door.position.z - self.position.z)
          if (dist > door.interaction_radius_m) return this.error('OUT_OF_RANGE', 'Слишком далеко от двери', rid)
          const spawn = world.spawns.get(door.target_room_id)!
          this.epoch += 1
          this.ackSeq = 0
          this.ready = false
          Object.assign(self, {
            room_id: door.target_room_id,
            position: { ...spawn },
            rotation: { yaw: 0, pitch: 0 },
            movement_epoch: this.epoch,
            ack_seq: 0,
          })
          acc.pose = { room_id: self.room_id, position: { ...spawn }, rotation: { yaw: 0, pitch: 0 } }
          return this.send_('world.entered', { self, current_room: world.rooms.get(door.target_room_id)!.pkg }, rid)
        }
        case 'chat.send': {
          const text = (msg.payload.text ?? '').trim()
          const photo = msg.payload.photo_id ? photos.get(msg.payload.photo_id) : undefined
          if ((!text && !msg.payload.photo_id) || [...text].length > 500) {
            return this.error('VALIDATION_ERROR', 'Некорректное сообщение', rid)
          }
          if (msg.payload.photo_id && (!photo || photo.owner !== acc.user.id)) {
            return this.error('NOT_FOUND', 'Фото не найдено', rid)
          }
          if (photo) photo.photo.published = true
          return this.send_(
            'chat.message',
            {
              message_id: newId('msg'),
              author: { user_id: acc.user.id, display_name: acc.user.display_name },
              text,
              photo: photo?.photo ?? null,
            },
            rid,
          )
        }
        case 'exhibit.inspect': {
          if (!this.ready) return this.error('GAME_NOT_READY', 'Игра не готова', rid)
          const ex = world.rooms.get(self.room_id)!.room.exhibits.find((e) => e.id === msg.payload.exhibit_id)
          if (!ex) return this.error('NOT_FOUND', 'Нет такого экспоната', rid)
          const dist = Math.hypot(ex.position.x - self.position.x, ex.position.z - self.position.z)
          if (dist > ex.interaction_radius_m) return this.error('OUT_OF_RANGE', 'Слишком далеко', rid)
          return this.send_('exhibit.inspected', { exhibit_id: ex.id, inspected_at: now() }, rid)
        }
        case 'guide.ask':
          return this.guideAsk(msg.payload, rid!)
        case 'guide.cancel':
          return this.guideCancel(msg.payload.generation_id, rid!)
      }
    }

    // --- Гид: queued → running → delta… → completed ---

    private active: { gen: Generation; timer: ReturnType<typeof setInterval> } | null = null

    private guideAsk(p: { guide_id: string; text: string; exhibit_id?: string }, rid: string) {
      if (!this.ready) return this.error('GAME_NOT_READY', 'Игра не готова', rid)
      const text = p.text.trim()
      if (!text || [...text].length > 2000) return this.error('VALIDATION_ERROR', 'Текст 1–2000 символов', rid)
      const self = this.self!
      const guide = world.rooms.get(self.room_id)!.room.guides.find((g) => g.id === p.guide_id)
      if (!guide) return this.error('NOT_FOUND', 'Гида нет в этом зале', rid)
      const dist = Math.hypot(guide.position.x - self.position.x, guide.position.z - self.position.z)
      if (dist > guide.interaction_radius_m) return this.error('OUT_OF_RANGE', 'Слишком далеко от гида', rid)
      if (this.active) return this.error('GUIDE_BUSY', 'Предыдущий вопрос ещё обрабатывается', rid)

      const userMsg: DialogMessage = { id: newId('dm'), role: 'user', text, created_at: now() }
      const gen: Generation = {
        id: newId('gen'),
        request_id: rid,
        guide_id: p.guide_id,
        exhibit_id: p.exhibit_id ?? null,
        status: 'queued',
        user_message: userMsg,
        assistant_message: null,
        error: null,
      }
      const key = `${session!.account.user.id}:${p.guide_id}`
      generations.set(key, [...(generations.get(key) ?? []), gen])
      this.send_('guide.accepted', { generation: { ...gen } }, rid)

      const chunks = GUIDE_REPLY.match(/.{1,12}/gs)!
      let index = 0
      this.later(() => {
        gen.status = 'running'
        this.send_('guide.started', { generation_id: gen.id }, rid)
        const timer = setInterval(() => {
          if (index < chunks.length) {
            this.send_('guide.delta', { generation_id: gen.id, index, text: chunks[index] }, rid)
            index += 1
            return
          }
          clearInterval(timer)
          this.active = null
          gen.status = 'completed'
          gen.assistant_message = { id: newId('dm'), role: 'assistant', text: GUIDE_REPLY, created_at: now() }
          this.send_('guide.completed', { generation: { ...gen } }, rid)
        }, 60)
        this.active = { gen, timer }
      }, 400)
      this.active = { gen, timer: 0 as unknown as ReturnType<typeof setInterval> }
    }

    private guideCancel(generationId: string, rid: string) {
      const all = [...generations.values()].flat()
      const gen = all.find((g) => g.id === generationId)
      if (!gen) return this.error('NOT_FOUND', 'Генерация не найдена', rid)
      if (gen.status === 'queued' || gen.status === 'running') {
        if (this.active) clearInterval(this.active.timer)
        this.active = null
        gen.status = 'failed'
        gen.error = { code: 'CANCELLED', message: 'Отменено', retryable: false }
        this.send_('guide.failed', { generation: { ...gen } }, gen.request_id)
      }
      this.send_('guide.cancelled', { generation: { ...gen } }, rid)
    }
  }

  // --- fetch ---

  const realFetch = window.fetch.bind(window)
  const fetchMock: MockServer['fetch'] = async (input, init) => {
    const req = new Request(input, init)
    const path = new URL(req.url, location.origin).pathname
    if (!path.startsWith(API_BASE)) return realFetch(input, init)
    await new Promise((r) => setTimeout(r, 40))
    return handle(req)
  }

  const RealWebSocket = window.WebSocket
  const WebSocketMock = function (url: string | URL, protocols?: string | string[]) {
    const u = new URL(String(url), location.href)
    if (u.pathname !== WS_PATH) return new RealWebSocket(url, protocols)
    return new MockSocket(u.href)
  } as unknown as typeof WebSocket
  Object.assign(WebSocketMock, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })

  return { fetch: fetchMock, WebSocket: WebSocketMock }
}
