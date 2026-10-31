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

export async function fetchRoomText(roomId: string, version: string, signal?: AbortSignal): Promise<string> {
  const path = `/world/rooms/${encodeURIComponent(roomId)}?version=${encodeURIComponent(version)}`
  return (await apiFetch(path, { signal })).text()
}

export async function fetchAssetBlob(assetId: string, version: string, signal?: AbortSignal): Promise<Blob> {
  const path = `/world/assets/${encodeURIComponent(assetId)}?version=${encodeURIComponent(version)}`
  return (await apiFetch(path, { signal })).blob()
}
