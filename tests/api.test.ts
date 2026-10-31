import { expect, test } from 'bun:test'
import { ApiError, ContentError, fetchGenerations, fetchMe, readLimited, uploadPhoto } from '../src/network/api'

function streamResponse(chunks: number[], headers: Record<string, string> = {}) {
  let pulled = 0
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= chunks.length) return controller.close()
      controller.enqueue(new Uint8Array(chunks[pulled++]))
    },
    cancel() {
      cancelled = true
    },
  })
  return { res: new Response(body, { headers }), stats: () => ({ pulled, cancelled }) }
}

test('readLimited возвращает байты, если размер в пределах объявленного', async () => {
  const { res } = streamResponse([4, 6])
  const bytes = await readLimited(res, 10)
  expect(bytes.length).toBe(10)
})

test('readLimited прекращает чтение, как только превышен объявленный размер', async () => {
  const { res, stats } = streamResponse([6, 6, 6, 6])
  await expect(readLimited(res, 10)).rejects.toBeInstanceOf(ContentError)
  expect(stats().pulled).toBeLessThan(4)
  expect(stats().cancelled).toBe(true)
})

test('readLimited отклоняет по Content-Length, не читая тело', async () => {
  const { res, stats } = streamResponse([6, 6], { 'Content-Length': '12' })
  await expect(readLimited(res, 10)).rejects.toBeInstanceOf(ContentError)
  expect(stats().pulled).toBeLessThanOrEqual(1)
})

test('fetchMe возвращает null при 401 и бросает ApiError при 500', async () => {
  const orig = globalThis.fetch
  const reply = (status: number) =>
    (globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { code: 'X', message: 'm', request_id: 'r' } }), { status })) as unknown as typeof fetch)
  try {
    reply(401)
    expect(await fetchMe()).toBeNull()
    reply(500)
    await expect(fetchMe()).rejects.toBeInstanceOf(ApiError)
  } finally {
    globalThis.fetch = orig
  }
})

test('fetchGenerations запрашивает 20 записей и передаёт before; 404 — ApiError', async () => {
  const orig = globalThis.fetch
  const urls: string[] = []
  let status = 200
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url))
    return status === 200
      ? new Response(JSON.stringify({ items: [], next_before: null }))
      : new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'm', request_id: 'r' } }), { status })
  }) as unknown as typeof fetch
  try {
    expect(await fetchGenerations('guide_1', null)).toEqual({ items: [], next_before: null })
    await fetchGenerations('guide_1', 'gen 2')
    expect(urls[0].endsWith('/guides/guide_1/generations?limit=20')).toBe(true)
    expect(urls[1].endsWith('/guides/guide_1/generations?limit=20&before=gen%202')).toBe(true)
    status = 404
    const err = await fetchGenerations('guide_1', null).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(404)
  } finally {
    globalThis.fetch = orig
  }
})

test('uploadPhoto: POST /photos с Idempotency-Key и тем же FormData; 409 — ApiError', async () => {
  const orig = globalThis.fetch
  const seen: { url: string; init: RequestInit }[] = []
  let status = 201
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url: String(url), init })
    return status === 201
      ? new Response(JSON.stringify({ id: 'p1' }), { status })
      : new Response(JSON.stringify({ error: { code: 'IDEMPOTENCY_CONFLICT', message: 'm', request_id: 'r' } }), { status })
  }) as unknown as typeof fetch
  try {
    const form = new FormData()
    form.append('room_id', 'r1')
    expect((await uploadPhoto(form, 'k1')).id).toBe('p1')
    expect(seen[0].url.endsWith('/api/v1/photos')).toBe(true)
    expect(seen[0].init.method).toBe('POST')
    expect(new Headers(seen[0].init.headers).get('Idempotency-Key')).toBe('k1')
    expect(seen[0].init.body).toBe(form)
    status = 409
    const err = await uploadPhoto(form, 'k1').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('IDEMPOTENCY_CONFLICT')
  } finally {
    globalThis.fetch = orig
  }
})
