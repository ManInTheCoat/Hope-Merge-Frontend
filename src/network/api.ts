import {
  API_BASE,
  type AuthResponse,
  type ErrorBody,
  type Generation,
  type GenerationsPage,
  type HttpErrorBody,
  type LoginRequest,
  type Manifest,
  type MeResponse,
  type Photo,
  type RegisterRequest,
  type Room,
  type User,
} from './contract'

type ApiErrorExtra = Pick<ErrorBody, 'retry_after_ms' | 'fields'>

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly retryAfterMs?: number
  readonly fields?: Record<string, string>

  constructor(status: number, code: string, message: string, extra: ApiErrorExtra = {}) {
    super(message)
    this.status = status
    this.code = code
    this.retryAfterMs = extra.retry_after_ms
    this.fields = extra.fields
  }
}

/** Файл мира больше объявленного в пакете зала: загрузку прерываем, результат выбрасываем (api.md, «Учёт бюджета»). */
export class ContentError extends Error {}

/**
 * Читает тело, не давая ему вырасти больше `maxBytes`: при превышении чтение прекращается сразу.
 * Объявленные размеры — байты до HTTP-сжатия, поэтому Content-Length проверяем только без Content-Encoding.
 */
export async function readLimited(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('Content-Length'))
  if (!res.headers.has('Content-Encoding') && Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel()
    throw new ContentError(`Ответ ${declared} байт при объявленных ${maxBytes}`)
  }
  if (!res.body) return new Uint8Array(await res.arrayBuffer())

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxBytes) {
      await reader.cancel()
      throw new ContentError(`Ответ больше объявленных ${maxBytes} байт`)
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, { cache: 'no-store', ...init })
  if (res.ok) return res
  let code = 'HTTP_ERROR'
  let message = `HTTP ${res.status}`
  let extra: ApiErrorExtra = {}
  try {
    const body = (await res.json()) as HttpErrorBody
    code = body.error.code
    message = body.error.message
    extra = { retry_after_ms: body.error.retry_after_ms, fields: body.error.fields }
  } catch {
    // тело не JSON — остаются значения по умолчанию
  }
  throw new ApiError(res.status, code, message, extra)
}

export async function fetchManifest(signal?: AbortSignal): Promise<Manifest> {
  return (await apiFetch('/world/manifest', { signal })).json()
}

/** Последняя страница истории с гидом или страница старше `before` (api.md §7). */
export async function fetchGenerations(guideId: string, before: string | null, signal?: AbortSignal): Promise<GenerationsPage> {
  const cursor = before === null ? '' : `&before=${encodeURIComponent(before)}`
  return (await apiFetch(`/guides/${encodeURIComponent(guideId)}/generations?limit=20${cursor}`, { signal })).json()
}

/** Генерация по request_id исходного вопроса; null — вопрос не принят (api.md §7, «История и восстановление»). */
export async function fetchGenerationByRequest(guideId: string, requestId: string, signal?: AbortSignal): Promise<Generation | null> {
  try {
    const path = `/guides/${encodeURIComponent(guideId)}/generations/by-request/${encodeURIComponent(requestId)}`
    return (await (await apiFetch(path, { signal })).json()) as Generation
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null
    throw e
  }
}

/** Описание зала и точный размер полученного файла: бюджет учитывает именно его (api.md, «Учёт бюджета»). */
export async function fetchRoom(roomId: string, version: string, maxBytes: number, signal?: AbortSignal): Promise<{ room: Room; bytes: number }> {
  const path = `/world/rooms/${encodeURIComponent(roomId)}?version=${encodeURIComponent(version)}`
  const raw = await readLimited(await apiFetch(path, { signal }), maxBytes)
  return { room: JSON.parse(new TextDecoder().decode(raw)) as Room, bytes: raw.length }
}

export async function fetchAssetBlob(assetId: string, version: string, maxBytes: number, signal?: AbortSignal): Promise<Blob> {
  const path = `/world/assets/${encodeURIComponent(assetId)}?version=${encodeURIComponent(version)}`
  const res = await apiFetch(path, { signal })
  const type = res.headers.get('Content-Type') ?? ''
  const bytes = await readLimited(res, maxBytes)
  return new Blob([bytes as BlobPart], { type })
}

const postJson = (path: string, body?: unknown) =>
  apiFetch(path, {
    method: 'POST',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })

export async function register(body: RegisterRequest): Promise<User> {
  return ((await (await postJson('/auth/register', body)).json()) as AuthResponse).user
}

export async function login(body: LoginRequest): Promise<User> {
  return ((await (await postJson('/auth/login', body)).json()) as AuthResponse).user
}

export async function logout(): Promise<void> {
  await postJson('/auth/logout')
}

/** `null` — сессии нет (401); остальные ошибки пробрасываются. */
export async function fetchMe(): Promise<MeResponse | null> {
  try {
    return (await apiFetch('/me')).json()
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null
    throw e
  }
}

/** `POST /photos` (api.md, «Фото»). Content-Type с границей multipart выставляет браузер. */
export async function uploadPhoto(form: FormData, key: string, signal?: AbortSignal): Promise<Photo> {
  const res = await apiFetch('/photos', { method: 'POST', headers: { 'Idempotency-Key': key }, body: form, signal })
  return res.json()
}
