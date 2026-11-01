import { apiFetch } from './api'
import type {
  SundayAdminGuide,
  SundayClientMetric,
  SundayClients,
  SundayGuides,
  SundayGuideUpdate,
  SundayRoomRuntime,
  SundayRooms,
  SundayRoomUpdate,
} from './sunday'

// HTTP админки (api-sunday.md §3). Роль сервер проверяет на каждом запросе.

const enc = encodeURIComponent

const putJson = (path: string, body: unknown) =>
  apiFetch(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

/** `true` только при 200: 401, 403 и любой сбой означают «кнопку не показывать». */
export async function fetchAdminMe(): Promise<boolean> {
  try {
    await apiFetch('/admin/me')
    return true
  } catch {
    return false
  }
}

export async function fetchAdminClients(signal?: AbortSignal): Promise<SundayClientMetric[]> {
  return ((await (await apiFetch('/admin/clients', { signal })).json()) as SundayClients).clients
}

export async function fetchAdminRooms(): Promise<SundayRooms['rooms']> {
  return ((await (await apiFetch('/admin/rooms')).json()) as SundayRooms).rooms
}

export async function fetchAdminRoom(id: string): Promise<SundayRoomRuntime> {
  return (await apiFetch(`/admin/rooms/${enc(id)}`)).json()
}

export async function putAdminRoom(id: string, body: SundayRoomUpdate): Promise<SundayRoomRuntime> {
  return (await putJson(`/admin/rooms/${enc(id)}`, body)).json()
}

export async function fetchAdminGuides(): Promise<SundayGuides['guides']> {
  return ((await (await apiFetch('/admin/guides')).json()) as SundayGuides).guides
}

export async function fetchAdminGuide(id: string): Promise<SundayAdminGuide> {
  return (await apiFetch(`/admin/guides/${enc(id)}`)).json()
}

export async function putAdminGuide(id: string, body: SundayGuideUpdate): Promise<SundayAdminGuide> {
  return (await putJson(`/admin/guides/${enc(id)}`, body)).json()
}
