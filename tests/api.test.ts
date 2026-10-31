import { expect, test } from 'bun:test'
import { ApiError, ContentError, fetchMe, readLimited } from '../src/network/api'

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
