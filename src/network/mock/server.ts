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
  type ServerEnvelope,
  type ServerEventType,
  type ServerEvents,
  type User,
  type Vec3,
} from '../contract'
import { wrapAngle } from '../../scene/angles'
import { mockSpeedOk, mockSweep, mockValidPose } from './geometry'
import { checkPhotoForm, photoFingerprint } from './photoForm'
import type { SundayClientMetric, SundayLamp, SundayRoomConfig } from '../sunday'
import { createAdminState } from './admin'
import { defaultRuntime } from './runtime'
import { loadMockState, mergeMockState, repairPose, saveMockState, type StoredAccount } from './storage'
import { START_POSITION, START_ROOM_ID, WORLD_VERSION, type MockWorld } from './world'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const COLORS = ['#e57373', '#64b5f6', '#81c784', '#ffb74d', '#ba68c8']
const GUIDE_REPLY =
  'Здравствуйте! Этот экспонат относится к раннему периоду коллекции. Обратите внимание на композицию и цвет: ' +
  'по ним специалисты определяют время и место создания. Если хотите, расскажу и о соседних работах.'

const BOT_JOIN_DELAY_MS = 3_000
const BOT_STAY_MS = 40_000
const BOT_AWAY_MS = 10_000
const BOT_CHAT_EVERY_MS = 30_000
const BOT_REPLIES = ['Интересно!', 'Я тоже здесь впервые', 'Посмотрите на амфору у северной стены', 'Согласен', 'Красиво тут']
const CHAT_LIMIT = 5
const CHAT_WINDOW_MS = 10_000
const SYNC_LIMIT = 2
const SYNC_WINDOW_MS = 10_000
/** Код, который браузер видит при отказе upgrade (например, HTTP 401 до открытия WS). */
const ABNORMAL_CLOSE = 1006
/** `telemetry.probe` уходит раз в 5 с после snapshot; без ответа за это же время ping становится null (api-sunday.md §7). */
const PROBE_EVERY_MS = 5_000
const PING_TIMEOUT_MS = 5_000
/** FPS протухает через 6 с без валидного `client.metrics`. */
const METRICS_STALE_MS = 6_000
/** Предел каждого типа telemetry: 2 в секунду на соединение, лишние валидные отбрасываются молча. */
const TELEMETRY_LIMIT = 2
const TELEMETRY_WINDOW_MS = 1_000
/** Все PUT админки вместе: 10 за 10 с на пользователя (api-sunday.md §3). */
const ADMIN_PUT_LIMIT = 10
const ADMIN_PUT_WINDOW_MS = 10_000
const TELEMETRY_TYPES: ReadonlySet<string> = new Set(['client.metrics', 'telemetry.pong'])
/** Позиция сохраняется раз в 5 секунд и при штатном отключении (api.md §2). */
const POSE_SAVE_EVERY_MS = 5_000

type Account = StoredAccount
type Session = { account: Account }

/** Поля полезной нагрузки команд WS: обязательные с типом, необязательные со знаком «?» (api.md §1: лишние — отказ). */
const WS_FIELDS: Record<string, Record<string, string>> = {
  'world.ready': { world_version: 'string', movement_epoch: 'number' },
  'world.enter': { door_id: 'string', movement_epoch: 'number' },
  'player.move': { movement_epoch: 'number', seq: 'number', position: 'object', rotation: 'object' },
  'chat.send': { text: '?string', photo_id: '?string' },
  'exhibit.inspect': { exhibit_id: 'string' },
  'guide.ask': { guide_id: 'string', text: 'string', exhibit_id: '?string' },
  'guide.cancel': { generation_id: 'string' },
  'room.sync': {},
}

/** Ровно эти поля нужных типов: лишние и отсутствующие обязательные — VALIDATION_ERROR. */
function fieldsOk(value: unknown, spec: Record<string, string>): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const obj = value as Record<string, unknown>
  if (Object.keys(obj).some((k) => !(k in spec))) return false
  return Object.entries(spec).every(([k, t]) => {
    const optional = t.startsWith('?')
    if (!(k in obj)) return optional
    return typeof obj[k] === t.replace('?', '')
  })
}

export type MockServer = {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  WebSocket: typeof WebSocket
  /** Закрыть текущее игровое соединение кодом `code`: ручная проверка переподключения (api.md §4). */
  drop(code: number): void
  /**
   * Меняет runtime текущего зала игрока (revision + 1) и рассылает полный снимок: ручная проверка из консоли,
   * пока нет админки (у сервера это PUT /admin/rooms/{id}).
   */
  patchRuntime(patch: { config?: Partial<SundayRoomConfig>; lamp?: Partial<SundayLamp> }): void
  /** Что видит админка в GET /admin/clients: FPS, ping и видимость вкладки текущего соединения (пусто без соединения). */
  clients(): SundayClientMetric[]
  /** Выдаёт роль администратора существующему аккаунту (у сервера — `./bin/admin grant`); false — нет такого имени. */
  grantAdmin(username: string): boolean
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

/** `opts.now` — часы для проверки скорости движения и RTT (в тестах — ручные); `opts.probeEveryMs` — период probe. */
export function createMockServer(
  world: MockWorld,
  storage: Storage | null = null,
  opts: { now?: () => number; probeEveryMs?: number } = {},
): MockServer {
  const probeEveryMs = opts.probeEveryMs ?? PROBE_EVERY_MS
  const clock = opts.now ?? (() => performance.now())
  const stored = loadMockState(storage)
  const startPose = { room_id: START_ROOM_ID, position: { ...START_POSITION }, rotation: { yaw: 0, pitch: 0 } }
  // Мир мог измениться с прошлого запуска: позу из хранилища приводим к допустимой.
  const poseOk = (id: string, p: Vec3) => {
    const room = world.rooms.get(id)?.room
    return !!room && mockValidPose(room, p)
  }
  stored.accounts.forEach((a) => (a.pose = repairPose(a.pose, poseOk, startPose)))
  const accounts = new Map<string, Account>(stored.accounts.map((a) => [a.user.username, a]))
  const photos = new Map<string, { photo: Photo; blob: Blob; owner: string }>()
  const idempotent = new Map<string, { photo: Photo; fingerprint: string }>()
  const generations = new Map<string, Generation[]>()
  const knownGuides = new Set([...world.rooms.values()].flatMap((r) => r.room.guides.map((g) => g.id)))
  let session: Session | null = stored.session ? { account: accounts.get(stored.session)! } : null
  let poseSavedAt = 0
  /** Аккаунты, которые эта вкладка создала или под которыми входила. */
  const touched = new Set<string>()

  /** Аккаунты, позы и сессия переживают перезагрузку страницы (у реального бэкенда — БД и cookie). */
  function persist() {
    poseSavedAt = Date.now()
    // Пишем только свои аккаунты: копии чужих, загруженные при старте, могли устареть в другой вкладке.
    const current = session?.account.user.username
    const own = [...accounts.values()].filter((a) => touched.has(a.user.username) || a.user.username === current)
    const mine = { accounts: own, session: session?.account.user.username ?? null }
    saveMockState(storage, mergeMockState(loadMockState(storage), mine))
  }

  /** Аккаунты, зарегистрированные в другой вкладке после запуска этой. */
  function refreshAccounts() {
    for (const a of loadMockState(storage).accounts) {
      if (accounts.has(a.user.username)) continue
      a.pose = repairPose(a.pose, poseOk, startPose)
      accounts.set(a.user.username, a)
    }
  }

  function persistPoseThrottled() {
    if (Date.now() - poseSavedAt >= POSE_SAVE_EVERY_MS) persist()
  }
  let socket: MockSocket | null = null
  /** Время отправки сообщений чата по user_id: окно не сбрасывается переподключением (api.md §9). */
  const chatSends = new Map<string, number[]>()
  /** Время room.sync по user_id (api-sunday.md §8: не больше 2 за 10 с). */
  const syncs = new Map<string, number[]>()
  /** Runtime залов: у сервера он в PostgreSQL, здесь — в памяти вкладки. */
  const runtimes = new Map([...world.rooms].map(([id, r]) => [id, defaultRuntime(r.room)]))
  const admin = createAdminState(world, runtimes)
  /** Время PUT админки по user_id. */
  const adminPuts = new Map<string, number[]>()

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
      const spec: Record<string, string> =
        path === '/auth/register'
          ? { username: 'string', display_name: 'string', password: 'string' }
          : { username: 'string', password: 'string' }
      if (!fieldsOk(body, spec)) return httpError(400, 'VALIDATION_ERROR', 'Некорректные данные')
      refreshAccounts()
      // Новая сессия отзывает прежнюю из cookie и закрывает её WS (api.md §2).
      socket?.serverClose(CloseCode.SessionExpired)
      if (path === '/auth/register') {
        const username = String(body.username ?? '').trim().toLowerCase()
        const display_name = String(body.display_name ?? '').trim()
        const password = String(body.password ?? '')
        const passwordBytes = new TextEncoder().encode(password).length
        if (
          !/^[a-z0-9_]{3,32}$/.test(username) ||
          !display_name ||
          [...display_name].length > 32 ||
          display_name.includes('\u0000') ||
          passwordBytes < 8 ||
          passwordBytes > 128
        ) {
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
          admin: accounts.size === 0, // первый аккаунт — администратор, остальным роль выдаёт __mock.grantAdmin
          pose: { room_id: START_ROOM_ID, position: { ...START_POSITION }, rotation: { yaw: 0, pitch: 0 } },
        }
        accounts.set(username, account)
        touched.add(username)
        session = { account }
        persist()
        return json(201, { user })
      }
      const account = accounts.get(String(body.username ?? '').toLowerCase())
      if (!account || account.password !== body.password) {
        return httpError(401, 'INVALID_CREDENTIALS', 'Неверное имя или пароль')
      }
      session = { account }
      touched.add(account.user.username)
      persist()
      return json(200, { user: account.user })
    }

    if (method === 'POST' && path === '/auth/logout') {
      session = null
      persist()
      socket?.serverClose(CloseCode.SessionExpired)
      return json(204)
    }

    if (!session) return httpError(401, 'UNAUTHENTICATED', 'Нужен вход')
    const { account } = session

    if (method === 'GET' && path === '/me') {
      return json(200, { user: account.user, player_state: account.pose })
    }

    if (path.startsWith('/admin/')) return handleAdmin(req, method, path, account)

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

    const byRequest = path.match(/^\/guides\/([^/]+)\/generations\/by-request\/([^/]+)$/)
    if (method === 'GET' && byRequest) {
      const guideId = decodeURIComponent(byRequest[1])
      const requestId = decodeURIComponent(byRequest[2])
      const gen = (generations.get(`${account.user.id}:${guideId}`) ?? []).find((g) => g.request_id === requestId)
      return gen ? json(200, gen) : httpError(404, 'NOT_FOUND', 'Вопрос не найден')
    }

    const genMatch = path.match(/^\/guides\/([^/]+)\/generations$/)
    if (method === 'GET' && genMatch) {
      const guideId = decodeURIComponent(genMatch[1])
      if (!knownGuides.has(guideId)) return httpError(404, 'NOT_FOUND', 'Нет такого гида')
      const all = generations.get(`${account.user.id}:${guideId}`) ?? []
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 20) || 20, 1), 50)
      const before = url.searchParams.get('before')
      let end = all.length
      if (before !== null) {
        end = all.findIndex((g) => g.id === before)
        if (end < 0) return httpError(400, 'INVALID_CURSOR', 'Неверный курсор')
      }
      const start = Math.max(end - limit, 0)
      const items = all.slice(start, end)
      return json(200, { items, next_before: start > 0 ? items[0].id : null })
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

  /** `/admin/*`: роль проверяется на каждом запросе (api-sunday.md §3). */
  async function handleAdmin(req: Request, method: string, path: string, account: Account): Promise<Response> {
    if (!account.admin) return httpError(403, 'FORBIDDEN', 'Нужна роль администратора')
    const fail = (r: { status: number; code: string; message: string; fields?: Record<string, string>; retry_after_ms?: number }) => {
      const request_id = crypto.randomUUID()
      const error = {
        code: r.code,
        message: r.message,
        request_id,
        ...(r.fields ? { fields: r.fields } : {}),
        ...(r.retry_after_ms ? { retry_after_ms: r.retry_after_ms } : {}),
      }
      const retry: Record<string, string> = r.retry_after_ms ? { 'Retry-After': String(Math.ceil(r.retry_after_ms / 1000)) } : {}
      return json(r.status, { error }, { 'X-Request-ID': request_id, ...retry })
    }
    const id = (m: RegExpMatchArray) => decodeURIComponent(m[1])

    if (method === 'GET') {
      if (path === '/admin/me') return json(200, { user_id: account.user.id, role: 'admin' })
      if (path === '/admin/clients') {
        const row = socket?.metricsRow()
        return json(200, { clients: row ? [row] : [] })
      }
      if (path === '/admin/rooms') return json(200, admin.rooms())
      if (path === '/admin/guides') return json(200, admin.guides())
      const room = path.match(/^\/admin\/rooms\/([^/]+)$/)
      if (room) {
        const rt = admin.room(id(room))
        return rt ? json(200, rt) : httpError(404, 'NOT_FOUND', 'Нет такого зала')
      }
      const guide = path.match(/^\/admin\/guides\/([^/]+)$/)
      if (guide) {
        const g = admin.guide(id(guide))
        return g ? json(200, g) : httpError(404, 'NOT_FOUND', 'Нет такого гида')
      }
      return httpError(404, 'NOT_FOUND', 'Нет такого маршрута')
    }

    if (method === 'PUT') {
      const room = path.match(/^\/admin\/rooms\/([^/]+)$/)
      const guide = path.match(/^\/admin\/guides\/([^/]+)$/)
      if (!room && !guide) return httpError(404, 'NOT_FOUND', 'Нет такого маршрута')
      const t = clock()
      const sent = (adminPuts.get(account.user.id) ?? []).filter((x) => t - x < ADMIN_PUT_WINDOW_MS)
      adminPuts.set(account.user.id, sent)
      if (sent.length >= ADMIN_PUT_LIMIT) {
        const retry_after_ms = Math.ceil(ADMIN_PUT_WINDOW_MS - (t - sent[0]))
        return fail({ status: 429, code: 'RATE_LIMITED', message: 'Слишком часто', retry_after_ms })
      }
      sent.push(t)
      let body: unknown
      try {
        body = await req.json()
      } catch {
        return httpError(400, 'INVALID_JSON', 'Некорректный JSON')
      }
      if (room) {
        const r = admin.putRoom(id(room), body)
        if (!r.ok) return fail(r)
        socket?.pushRuntime(id(room))
        return json(200, r.value)
      }
      const r = admin.putGuide(id(guide!), body)
      if (!r.ok) return fail(r)
      r.value.touchedRooms.forEach((roomId) => socket?.pushRuntime(roomId))
      return json(200, r.value.guide)
    }
    return httpError(404, 'NOT_FOUND', 'Нет такого маршрута')
  }

  async function createPhoto(req: Request, account: Account): Promise<Response> {
    const key = req.headers.get('Idempotency-Key') ?? ''
    if (!UUID_RE.test(key)) return httpError(400, 'VALIDATION_ERROR', 'Нужен Idempotency-Key (UUID v4)')
    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return httpError(400, 'VALIDATION_ERROR', 'Нужен multipart/form-data')
    }
    const invalid = checkPhotoForm(form)
    if (invalid) return httpError(400, 'VALIDATION_ERROR', invalid)
    const fingerprint = await photoFingerprint(form)
    const existing = idempotent.get(`${account.user.id}:${key}`)
    if (existing) {
      if (existing.fingerprint !== fingerprint) return httpError(409, 'IDEMPOTENCY_CONFLICT', 'Ключ уже использован другим запросом')
      return json(200, existing.photo)
    }
    if (!socket?.ready) return httpError(409, 'GAME_NOT_READY', 'Игра не готова')

    const file = form.get('image') as Blob
    if (file.type !== 'image/jpeg' && file.type !== 'image/webp') {
      return httpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Нужен JPEG или WebP')
    }
    if (file.size > 2 * 1024 * 1024) return httpError(413, 'PAYLOAD_TOO_LARGE', 'Файл больше 2 МиБ')
    if (Number(form.get('movement_epoch')) !== socket.epoch || form.get('room_id') !== account.pose.room_id) {
      return httpError(409, 'GAME_NOT_READY', 'Зал или epoch устарели')
    }
    const caption = String(form.get('caption') ?? '').trim()
    if ([...caption].length > 200 || caption.includes('\u0000')) return httpError(400, 'VALIDATION_ERROR', 'Подпись до 200 символов')
    const exhibitId = form.get('exhibit_id')
    if (typeof exhibitId === 'string') {
      const ex = world.rooms.get(account.pose.room_id)!.room.exhibits.find((e) => e.id === exhibitId)
      if (!ex) return httpError(404, 'NOT_FOUND', 'Нет такого экспоната')
      const pos = socket.selfPosition()
      if (!pos || Math.hypot(ex.position.x - pos.x, ex.position.z - pos.z) > ex.interaction_radius_m) {
        return httpError(403, 'OUT_OF_RANGE', 'Слишком далеко от экспоната')
      }
    }

    const id = newId('photo')
    const photo: Photo = {
      id,
      owner_id: account.user.id,
      caption,
      room_id: account.pose.room_id,
      exhibit_id: typeof exhibitId === 'string' ? exhibitId : null,
      published: false,
      image_url: `${API_BASE}/photos/${id}/image`,
      image_bytes: file.size,
      thumbnail_url: `${API_BASE}/photos/${id}/thumbnail`,
      thumbnail_bytes: Math.min(file.size, 128 * 1024), // миниатюра мока — условная, но в пределе api.md
      width: 1920,
      height: 1080,
      created_at: now(),
    }
    photos.set(id, { photo, blob: file, owner: account.user.id })
    idempotent.set(`${account.user.id}:${key}`, { photo, fingerprint })
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
    get currentRoomId(): string | null {
      return this.self?.room_id ?? null
    }
    private ackSeq = 0
    /** Время последнего обработанного move текущего epoch; сбрасывается первым world.ready epoch. */
    private lastMoveAt = 0
    private self: Player | null = null
    private seenRequests = new Set<string>()
    private timers = new Set<ReturnType<typeof setTimeout | typeof setInterval>>()
    private stateTimer: ReturnType<typeof setInterval> | null = null
    private probeTimer: ReturnType<typeof setInterval> | null = null
    private bot: Player

    // --- FPS и ping (api-sunday.md §7): данные живут столько же, сколько соединение ---

    private metrics: { fps: number | null; visible: boolean; at: number | null; iso: string | null } = {
      fps: null,
      visible: false,
      at: null,
      iso: null,
    }
    private pingMs: number | null = null
    /** Единственный неотвеченный probe соединения. */
    private probe: { nonce: string; sentAt: number } | null = null
    private telemetrySeen = new Map<string, number[]>()

    private sendProbe() {
      const nonce = crypto.randomUUID()
      this.probe = { nonce, sentAt: clock() }
      this.send_('telemetry.probe', { nonce })
    }

    /** Строка для админки; протухшее не показывает: FPS через 6 с → null, ping через 5 с без ответа → null. */
    metricsRow(): SundayClientMetric | null {
      const self = this.self
      if (!self || this.readyState !== 1) return null
      const t = clock()
      const m = this.metrics
      const stale = m.at === null || t - m.at >= METRICS_STALE_MS
      const pingLost = this.probe !== null && t - this.probe.sentAt >= PING_TIMEOUT_MS
      return {
        user_id: self.user_id,
        display_name: self.display_name,
        room_id: self.room_id,
        fps: stale ? null : m.fps,
        ping_ms: pingLost ? null : this.pingMs,
        visible: m.visible,
        sampled_at: m.iso,
        stale,
      }
    }

    /** `client.metrics` и `telemetry.pong`: без request_id, вне дедупликации и лимита команд, до ready тоже. */
    private telemetry(msg: ClientEnvelope) {
      const p: unknown = msg.payload
      const obj = typeof p === 'object' && p !== null && !Array.isArray(p) ? (p as Record<string, unknown>) : null
      const keysOk = (allowed: string[]) => !!obj && Object.keys(obj).every((k) => allowed.includes(k))
      let valid = false
      if (msg.type === 'client.metrics') {
        valid =
          keysOk(['fps', 'visible']) &&
          typeof obj!.visible === 'boolean' &&
          (obj!.visible
            ? typeof obj!.fps === 'number' && Number.isFinite(obj!.fps) && obj!.fps >= 0 && obj!.fps <= 1000
            : obj!.fps === null)
      } else {
        valid = keysOk(['nonce']) && typeof obj!.nonce === 'string' && obj!.nonce !== ''
      }
      if (!valid) return this.error('VALIDATION_ERROR', 'Некорректные поля')

      const t = clock()
      const seen = (this.telemetrySeen.get(msg.type) ?? []).filter((x) => t - x < TELEMETRY_WINDOW_MS)
      this.telemetrySeen.set(msg.type, seen)
      if (seen.length >= TELEMETRY_LIMIT) return // лишнее валидное — молча
      seen.push(t)

      if (msg.type === 'client.metrics') {
        const m = msg.payload as { fps: number | null; visible: boolean }
        this.metrics = { fps: m.fps, visible: m.visible, at: t, iso: now() }
        return
      }
      const nonce = (msg.payload as { nonce: string }).nonce
      const pending = this.probe
      if (!pending || pending.nonce !== nonce) return // чужой или повторный nonce
      this.probe = null
      if (t - pending.sentAt >= PING_TIMEOUT_MS) return // ответ позже 5 с: ping уже null
      this.pingMs = Math.max(0, t - pending.sentAt)
    }

    readonly url: string

    constructor(url: string) {
      super()
      this.url = url
      const open = () => {
        const acc = session?.account
        if (!acc) return this.fail(ABNORMAL_CLOSE)
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
          players: [],
          current_room: world.rooms.get(pose.room_id)!.pkg,
        })
        this.send_('world.runtime', runtimes.get(pose.room_id)!) // сразу за snapshot (api-sunday.md §1)
        this.stateTimer = setInterval(() => this.broadcastState(), 100)
        this.probeTimer = setInterval(() => this.sendProbe(), probeEveryMs)
        this.later(() => this.botJoin(), BOT_JOIN_DELAY_MS)
        this.later(() => this.botChatLoop(), BOT_CHAT_EVERY_MS)
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
      // Касательная к кругу (−sin t, cos t); взгляд при yaw = 0 вдоль −Z, поэтому yaw = π − t.
      this.bot.rotation = { yaw: wrapAngle(Math.PI - t), pitch: 0 }
      return this.bot
    }

    private botPresent = false

    private botInRoom(): boolean {
      return this.botPresent && this.self?.room_id === this.bot.room_id
    }

    private botJoin() {
      this.botPresent = true
      this.send_('player.joined', { player: { ...this.botPlayer() } })
      this.later(() => this.botLeave(), BOT_STAY_MS)
    }

    private botLeave() {
      this.botPresent = false
      this.send_('player.left', { user_id: this.bot.user_id })
      this.later(() => this.botJoin(), BOT_AWAY_MS)
    }

    private botSay(text: string) {
      if (!this.botInRoom()) return
      this.send_('chat.message', {
        message_id: newId('msg'),
        author: { user_id: this.bot.user_id, display_name: this.bot.display_name },
        text,
        photo: null,
      })
    }

    private botChatLoop() {
      this.botSay(BOT_REPLIES[Math.floor(Math.random() * BOT_REPLIES.length)])
      this.later(() => this.botChatLoop(), BOT_CHAT_EVERY_MS)
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

    /** Рассылает runtime зала, если игрок сейчас в нём (без request_id, как спонтанное обновление). */
    pushRuntime(roomId: string) {
      if (this.self?.room_id === roomId) this.send_('world.runtime', runtimes.get(roomId)!)
    }

    private error(code: string, message: string, request_id?: string, extra: Partial<ErrorBody> = {}) {
      this.send_('error', { code, message, ...extra }, request_id)
    }

    private broadcastState() {
      if (!this.self) return
      const players = [this.self]
      if (this.botPresent) players.push(this.botPlayer())
      this.send_('players.state', { players })
    }

    private fail(code: number) {
      this.later(() => this.serverClose(code), 0)
    }

    selfPosition(): Vec3 | null {
      return this.self ? { ...this.self.position } : null
    }

    serverClose(code: number) {
      if (this.readyState === 3) return
      this.cancelGeneration() // разрыв и замена соединения отменяют его генерацию (api.md §7)
      this.readyState = 3
      this.ready = false
      if (this.stateTimer) clearInterval(this.stateTimer)
      if (this.probeTimer) clearInterval(this.probeTimer)
      this.timers.forEach((t) => clearTimeout(t))
      this.timers.clear()
      if (socket === this) socket = null
      persist() // штатное отключение сохраняет позицию; синхронно, поэтому успевает внутри pagehide
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
      const rid = typeof msg?.request_id === 'string' ? msg.request_id : undefined
      if (TELEMETRY_TYPES.has(msg?.type)) return this.telemetry(msg)
      const spec = WS_FIELDS[msg?.type]
      if (!spec) return this.error('UNKNOWN_EVENT', 'Неизвестная команда', rid)
      const envelopeOk = Object.keys(msg).every((k) => k === 'type' || k === 'request_id' || k === 'payload')
      if (!envelopeOk || !fieldsOk(msg.payload, spec)) return this.error('VALIDATION_ERROR', 'Некорректные поля', rid)
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
          if (!this.ready) this.lastMoveAt = clock() // время движения отсчитывается от первого ready epoch
          this.ready = true
          return this.send_('world.ready', { movement_epoch: this.epoch }, rid)
        }
        case 'player.move': {
          // Правила сервера (api.md §5): старый epoch и повтор seq — без ответа, будущий epoch — ошибка.
          const p = msg.payload
          if (p.movement_epoch < this.epoch) return
          if (p.movement_epoch > this.epoch) return this.error('VALIDATION_ERROR', 'Будущий epoch')
          if (!this.ready || p.seq <= this.ackSeq) return
          if (!Number.isInteger(p.seq) || p.seq < 1 || p.position.y !== 0) return this.error('VALIDATION_ERROR', 'Некорректный шаг')
          const t = clock()
          const dt = (t - this.lastMoveAt) / 1000
          this.lastMoveAt = t
          this.ackSeq = p.seq
          self.ack_seq = p.seq
          self.rotation = p.rotation
          const room = world.rooms.get(self.room_id)!.room
          const to = { x: p.position.x, y: 0, z: p.position.z }
          // Превышение скорости или путь сквозь блок: позиция прежняя, ack_seq обновлён.
          if (mockSpeedOk(self.position, to, dt) && mockSweep(room, self.position, to)) self.position = to
          acc.pose = { room_id: self.room_id, position: self.position, rotation: self.rotation }
          return persistPoseThrottled()
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
          this.cancelGeneration() // переход отменяет незавершённый вопрос (api.md §7)
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
          persist() // переход сохраняется до подтверждения (api.md §2)
          this.send_('world.entered', { self, current_room: world.rooms.get(door.target_room_id)!.pkg }, rid)
          return this.send_('world.runtime', runtimes.get(door.target_room_id)!) // world.entered опережает runtime
        }
        case 'room.sync': {
          // Требует owning WS, но не ready; состояния не меняет. Ответ — полный снимок с request_id запроса.
          const nowMs = clock()
          const sent = (syncs.get(acc.user.id) ?? []).filter((t) => nowMs - t < SYNC_WINDOW_MS)
          syncs.set(acc.user.id, sent)
          if (sent.length >= SYNC_LIMIT) {
            return this.error('RATE_LIMITED', 'Слишком часто', rid, { retry_after_ms: Math.ceil(SYNC_WINDOW_MS - (nowMs - sent[0])) })
          }
          sent.push(nowMs)
          return this.send_('world.runtime', runtimes.get(self.room_id)!, rid)
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
          const nowMs = performance.now()
          const sent = (chatSends.get(acc.user.id) ?? []).filter((t) => nowMs - t < CHAT_WINDOW_MS)
          chatSends.set(acc.user.id, sent)
          if (sent.length >= CHAT_LIMIT) {
            const retry_after_ms = Math.ceil(CHAT_WINDOW_MS - (nowMs - sent[0]))
            return this.error('RATE_LIMITED', 'Слишком часто', rid, { retry_after_ms })
          }
          sent.push(nowMs)
          if (photo) photo.photo.published = true
          this.later(() => this.botSay(BOT_REPLIES[Math.floor(Math.random() * BOT_REPLIES.length)]), 1000 + Math.random() * 1000)
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

    /** Незавершённая генерация этого соединения; её таймеры — в общих timers сокета. */
    private gen: Generation | null = null

    private guideAsk(p: { guide_id: string; text: string; exhibit_id?: string }, rid: string) {
      if (!this.ready) return this.error('GAME_NOT_READY', 'Игра не готова', rid)
      const text = p.text.trim()
      if (!text || [...text].length > 2000 || text.includes('\u0000')) return this.error('VALIDATION_ERROR', 'Текст 1–2000 символов', rid)
      const self = this.self!
      const guide = world.rooms.get(self.room_id)!.room.guides.find((g) => g.id === p.guide_id)
      if (!guide) return this.error('NOT_FOUND', 'Гида нет в этом зале', rid)
      const dist = Math.hypot(guide.position.x - self.position.x, guide.position.z - self.position.z)
      if (dist > guide.interaction_radius_m) return this.error('OUT_OF_RANGE', 'Слишком далеко от гида', rid)
      // Один незавершённый вопрос на пользователя, а не на соединение (api.md §7).
      const userId = session!.account.user.id
      const busy = [...generations.entries()].some(
        ([k, list]) => k.startsWith(`${userId}:`) && list.some((g) => g.status === 'queued' || g.status === 'running'),
      )
      if (busy) return this.error('GUIDE_BUSY', 'Предыдущий вопрос ещё обрабатывается', rid)

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
      const key = `${userId}:${p.guide_id}`
      generations.set(key, [...(generations.get(key) ?? []), gen])
      this.gen = gen
      this.send_('guide.accepted', { generation: { ...gen } }, rid)

      const chunks = GUIDE_REPLY.match(/.{1,12}/gs)!
      let index = 0
      const step = () => {
        if (this.gen !== gen || gen.status !== 'running') return
        if (index < chunks.length) {
          this.send_('guide.delta', { generation_id: gen.id, index, text: chunks[index] }, rid)
          index += 1
          return this.later(step, 60)
        }
        this.gen = null
        gen.status = 'completed'
        gen.assistant_message = { id: newId('dm'), role: 'assistant', text: GUIDE_REPLY, created_at: now() }
        this.send_('guide.completed', { generation: { ...gen } }, rid)
      }
      this.later(() => {
        if (this.gen !== gen || gen.status !== 'queued') return
        gen.status = 'running'
        this.send_('guide.started', { generation_id: gen.id }, rid)
        this.later(step, 60)
      }, 400)
    }

    /** Отмена незавершённой генерации: терминальный статус больше не меняется (api.md §7). */
    private stopGeneration(gen: Generation) {
      if (this.gen === gen) this.gen = null
      if (gen.status !== 'queued' && gen.status !== 'running') return
      gen.status = 'failed'
      gen.error = { code: 'CANCELLED', message: 'Отменено', retryable: false }
      this.send_('guide.failed', { generation: { ...gen } }, gen.request_id)
    }

    /** Переход, разрыв или замена соединения отменяют его генерацию. */
    cancelGeneration() {
      if (this.gen) this.stopGeneration(this.gen)
    }

    private guideCancel(generationId: string, rid: string) {
      const owner = `${session!.account.user.id}:`
      const all = [...generations.entries()].filter(([k]) => k.startsWith(owner)).flatMap(([, v]) => v)
      const gen = all.find((g) => g.id === generationId)
      if (!gen) return this.error('NOT_FOUND', 'Генерация не найдена', rid)
      this.stopGeneration(gen)
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

  return {
    fetch: fetchMock,
    WebSocket: WebSocketMock,
    drop: (code) => socket?.serverClose(code),
    clients: () => {
      const row = socket?.metricsRow()
      return row ? [row] : []
    },
    grantAdmin(username) {
      refreshAccounts()
      const account = accounts.get(username.trim().toLowerCase())
      if (!account) return false
      account.admin = true
      touched.add(account.user.username)
      persist()
      return true
    },
    patchRuntime(patch) {
      const roomId = socket?.currentRoomId
      const rt = roomId ? runtimes.get(roomId) : undefined
      if (!roomId || !rt) return
      Object.assign(rt.config, patch.config)
      Object.assign(rt.lamp, patch.lamp)
      rt.revision += 1
      socket!.pushRuntime(roomId)
    },
  }
}
