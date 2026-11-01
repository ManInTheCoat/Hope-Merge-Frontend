import { expect, test } from 'bun:test'
import { mockServer } from './mockHarness'

type Json = Record<string, any>

async function setup() {
  const h = await mockServer(null)
  await h.register('alice') // первый аккаунт — администратор
  const get = async (path: string) => {
    const res = await h.http('GET', path)
    return { status: res.status, body: (await res.json().catch(() => null)) as Json | null }
  }
  const put = async (path: string, body: unknown) => {
    const res = await h.http('PUT', path, body)
    return { status: res.status, body: (await res.json().catch(() => null)) as Json | null }
  }
  const roomId = [...h.world.rooms.keys()][0]
  const room = async () => (await get(`/admin/rooms/${roomId}`)).body as Json
  const roomBody = async (patch: Json = {}, revision = 1) => {
    const rt = await room()
    return { world_version: rt.world_version, expected_revision: revision, config: { ...rt.config, ...patch } }
  }
  const guideId = ((await room()).guides[0] as Json).guide_id as string
  const guide = async () => (await get(`/admin/guides/${guideId}`)).body as Json
  const guideBody = async (patch: Json = {}, revision = 1) => {
    const g = await guide()
    return { world_version: g.world_version, expected_revision: revision, settings: { ...g.settings, ...patch } }
  }
  return { h, get, put, roomId, room, roomBody, guideId, guide, guideBody }
}

test('роль: первый аккаунт — админ, второй — 403, без сессии — 401', async () => {
  const { h, get } = await setup()
  const me = await get('/admin/me')
  expect(me.status).toBe(200)
  expect(me.body).toMatchObject({ role: 'admin' })
  await h.register('bob')
  expect((await get('/admin/me')).status).toBe(403)
  expect((await get('/admin/me')).body).toMatchObject({ error: { code: 'FORBIDDEN' } })
  await h.http('POST', '/auth/logout')
  expect((await get('/admin/me')).status).toBe(401)
})

test('grantAdmin выдаёт роль существующему аккаунту; неизвестное имя — false', async () => {
  const { h, get } = await setup()
  await h.register('bob')
  expect((await get('/admin/me')).status).toBe(403)
  expect(h.server.grantAdmin('bob')).toBe(true)
  expect((await get('/admin/me')).status).toBe(200)
  expect(h.server.grantAdmin('nobody')).toBe(false)
})

test('залы: список со всеми залами мира, неизвестный зал — 404', async () => {
  const { h, get } = await setup()
  const list = (await get('/admin/rooms')).body!.rooms as Json[]
  expect(list.map((r) => r.room_id).sort()).toEqual([...h.world.rooms.keys()].sort())
  expect(list.every((r) => r.revision === 1)).toBe(true)
  expect((await get('/admin/rooms/нет')).status).toBe(404)
})

test('PUT зала: успех повышает revision, повтор с прежней — REVISION_CONFLICT, чужая версия — WORLD_VERSION_MISMATCH', async () => {
  const { put, roomId, roomBody, room } = await setup()
  const ok = await put(`/admin/rooms/${roomId}`, await roomBody({ accent_color: '#112233' }))
  expect(ok.status).toBe(200)
  expect(ok.body).toMatchObject({ revision: 2, config: { accent_color: '#112233' } })
  expect((await room()).revision).toBe(2)

  const stale = await put(`/admin/rooms/${roomId}`, await roomBody({ accent_color: '#445566' }, 1))
  expect(stale.status).toBe(409)
  expect(stale.body).toMatchObject({ error: { code: 'REVISION_CONFLICT' } })
  expect((await room()).config.accent_color).toBe('#112233')

  const wrong = await put(`/admin/rooms/${roomId}`, { ...(await roomBody({}, 2)), world_version: 'x' })
  expect(wrong.status).toBe(409)
  expect(wrong.body).toMatchObject({ error: { code: 'WORLD_VERSION_MISMATCH' } })
})

test('PUT зала: невалидный конфиг — 400 с полем, revision не растёт', async () => {
  const { put, roomId, roomBody, room } = await setup()
  const rt = await room()
  const cases: Array<[string, Json]> = [
    ['npc_count', { npc_count: 41 }],
    ['lighting', { lighting: 'red' }],
    ['accent_color', { accent_color: 'red' }],
    ['guide_placements', { guide_placements: [] }],
  ]
  for (const [field, patch] of cases) {
    const res = await put(`/admin/rooms/${roomId}`, await roomBody(patch))
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
    expect(Object.keys(res.body!.error.fields ?? {})).toContain(field)
  }
  const extra = await put(`/admin/rooms/${roomId}`, { ...(await roomBody()), лишнее: 1 })
  expect(extra.status).toBe(400)
  expect((await room()).revision).toBe(rt.revision)
})

test('PUT зала: удерживаемая лампа — 409 OBJECT_BUSY', async () => {
  const { h, put, roomId, roomBody, room } = await setup()
  await h.join() // patchRuntime действует на зал подключённого игрока
  h.server.patchRuntime({ lamp: { holder_user_id: 'user_other' } })
  const res = await put(`/admin/rooms/${roomId}`, await roomBody({ npc_count: 5 }, (await room()).revision))
  expect(res.status).toBe(409)
  expect(res.body).toMatchObject({ error: { code: 'OBJECT_BUSY' } })
})

test('PUT гида: смена имени повышает revision гида и зала и меняет публичное имя', async () => {
  const { put, get, guideId, guideBody, roomId, room } = await setup()
  const res = await put(`/admin/guides/${guideId}`, await guideBody({ display_name: 'Новое имя' }))
  expect(res.status).toBe(200)
  expect(res.body).toMatchObject({ revision: 2, settings: { display_name: 'Новое имя' } })
  const rt = await room()
  expect(rt.revision).toBe(2)
  expect(rt.guides.find((g: Json) => g.guide_id === guideId).display_name).toBe('Новое имя')
  const list = (await get('/admin/guides')).body!.guides as Json[]
  expect(list.find((g) => g.guide_id === guideId)).toMatchObject({ display_name: 'Новое имя', revision: 2 })
  void roomId
})

test('PUT гида: смена только личности не трогает revision зала', async () => {
  const { put, guideId, guideBody, room } = await setup()
  const res = await put(`/admin/guides/${guideId}`, await guideBody({ personality: 'Строгий искусствовед' }))
  expect(res.status).toBe(200)
  expect((await room()).revision).toBe(1)
})

test('PUT гида: лимиты, материалы и конфликт', async () => {
  const { put, guideId, guideBody, guide } = await setup()
  const path = `/admin/guides/${guideId}`
  const g = await guide()
  const known = g.available_materials.map((m: Json) => m.id) as string[]
  const bad: Array<[string, Json]> = [
    ['personality', { personality: 'я'.repeat(2001) }],
    ['display_name', { display_name: '   ' }],
    ['constraints', { constraints: [] }],
    ['material_ids', { material_ids: ['нет_такого'] }],
    ['material_ids', { material_ids: [known[0], known[0]] }],
    ['personality', { personality: 'а'.repeat(2000), style: 'б'.repeat(1000), topic: 'в'.repeat(1000), constraints: ['г'.repeat(1000)] }],
  ]
  for (const [field, patch] of bad) {
    const res = await put(path, await guideBody(patch))
    expect(res.status).toBe(400)
    expect(Object.keys(res.body!.error.fields ?? {})).toContain(field)
  }
  expect((await guide()).revision).toBe(1)
  expect((await put(path, await guideBody({ topic: 'Новая тема' }))).status).toBe(200)
  const conflict = await put(path, await guideBody({ topic: 'Ещё' }, 1))
  expect(conflict.status).toBe(409)
  expect(conflict.body).toMatchObject({ error: { code: 'REVISION_CONFLICT' } })
  expect((await put('/admin/guides/нет', await guideBody())).status).toBe(404)
})

test('PUT admin: 11-й запрос за 10 с — 429 RATE_LIMITED', async () => {
  const { put, roomId, roomBody } = await setup()
  let revision = 1
  for (let i = 0; i < 10; i++) {
    const res = await put(`/admin/rooms/${roomId}`, await roomBody({ npc_count: i }, revision))
    expect(res.status).toBe(200)
    revision += 1
  }
  const limited = await put(`/admin/rooms/${roomId}`, await roomBody({ npc_count: 1 }, revision))
  expect(limited.status).toBe(429)
  expect(limited.body).toMatchObject({ error: { code: 'RATE_LIMITED' } })
  expect(limited.body!.error.retry_after_ms).toBeGreaterThan(0)
})

test('клиенты: пусто без WS, одна строка после входа', async () => {
  const { h, get } = await setup()
  expect((await get('/admin/clients')).body).toEqual({ clients: [] })
  await h.join()
  const clients = (await get('/admin/clients')).body!.clients as Json[]
  expect(clients).toHaveLength(1)
  expect(clients[0]).toMatchObject({ display_name: 'alice', stale: true, fps: null })
})

// --- HTTP-клиент админки поверх мока ---

import {
  fetchAdminClients,
  fetchAdminGuide,
  fetchAdminMe,
  fetchAdminRoom,
  fetchAdminRooms,
  putAdminGuide,
  putAdminRoom,
} from '../src/network/adminApi'
import { ApiError } from '../src/network/api'

/** Подменяет глобальный fetch на мок на время теста. */
async function withMockFetch<T>(fn: (h: Awaited<ReturnType<typeof setup>>) => Promise<T>): Promise<T> {
  const s = await setup()
  const real = globalThis.fetch
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => s.h.server.fetch(new URL(String(input), 'http://localhost').href, init)) as typeof fetch
  try {
    return await fn(s)
  } finally {
    globalThis.fetch = real
  }
}

test('adminApi: fetchAdminMe — true только для администратора', async () => {
  await withMockFetch(async ({ h }) => {
    expect(await fetchAdminMe()).toBe(true)
    await h.register('bob')
    expect(await fetchAdminMe()).toBe(false) // 403
    await h.http('POST', '/auth/logout')
    expect(await fetchAdminMe()).toBe(false) // 401
  })
})

test('adminApi: сеть недоступна — fetchAdminMe даёт false, а не исключение', async () => {
  const real = globalThis.fetch
  globalThis.fetch = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch
  try {
    expect(await fetchAdminMe()).toBe(false)
  } finally {
    globalThis.fetch = real
  }
})

test('adminApi: чтение залов, гидов и клиентов', async () => {
  await withMockFetch(async ({ roomId, guideId }) => {
    expect((await fetchAdminRooms()).some((r) => r.room_id === roomId)).toBe(true)
    expect((await fetchAdminRoom(roomId)).room_id).toBe(roomId)
    expect((await fetchAdminGuide(guideId)).guide_id).toBe(guideId)
    expect(await fetchAdminClients()).toEqual([])
  })
})

test('adminApi: PUT зала — успех и REVISION_CONFLICT как ApiError', async () => {
  await withMockFetch(async ({ roomId, roomBody }) => {
    const ok = await putAdminRoom(roomId, (await roomBody({ npc_count: 7 })) as never)
    expect(ok.revision).toBe(2)
    const stale = putAdminRoom(roomId, (await roomBody({ npc_count: 8 }, 1)) as never)
    await expect(stale).rejects.toBeInstanceOf(ApiError)
    await expect(stale).rejects.toMatchObject({ status: 409, code: 'REVISION_CONFLICT' })
  })
})

test('adminApi: PUT гида возвращает AdminGuide с новой revision', async () => {
  await withMockFetch(async ({ guideId, guideBody }) => {
    const g = await putAdminGuide(guideId, (await guideBody({ topic: 'Другая тема' })) as never)
    expect(g.revision).toBe(2)
    expect(g.settings.topic).toBe('Другая тема')
  })
})
