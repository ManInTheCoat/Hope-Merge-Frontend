import { API_BASE, type HttpErrorBody, type Manifest } from './contract'

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
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
  try {
    const body = (await res.json()) as HttpErrorBody
    code = body.error.code
    message = body.error.message
  } catch {
    // тело не JSON — остаются значения по умолчанию
  }
  throw new ApiError(res.status, code, message)
}

export async function fetchManifest(signal?: AbortSignal): Promise<Manifest> {
  return (await apiFetch('/world/manifest', { signal })).json()
}

export async function fetchRoomText(roomId: string, version: string, maxBytes: number, signal?: AbortSignal): Promise<string> {
  const path = `/world/rooms/${encodeURIComponent(roomId)}?version=${encodeURIComponent(version)}`
  const bytes = await readLimited(await apiFetch(path, { signal }), maxBytes)
  return new TextDecoder().decode(bytes)
}

export async function fetchAssetBlob(assetId: string, version: string, maxBytes: number, signal?: AbortSignal): Promise<Blob> {
  const path = `/world/assets/${encodeURIComponent(assetId)}?version=${encodeURIComponent(version)}`
  const res = await apiFetch(path, { signal })
  const type = res.headers.get('Content-Type') ?? ''
  const bytes = await readLimited(res, maxBytes)
  return new Blob([bytes as BlobPart], { type })
}
