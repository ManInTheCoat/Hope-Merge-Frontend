import { expect, test } from 'bun:test'
import { CHAT_THUMB_MAX, ChatThumbs, type ChatPhoto } from '../src/photo/chatThumbs'
import type { Photo } from '../src/network/contract'
import { AssetBudget } from '../src/world/AssetBudget'

const photo = (id: string): Photo => ({
  id,
  owner_id: 'u',
  caption: '',
  room_id: 'r',
  exhibit_id: null,
  published: true,
  image_url: `/i/${id}`,
  image_bytes: 1000,
  thumbnail_url: `/t/${id}`,
  thumbnail_bytes: 100,
  width: 1,
  height: 1,
  created_at: '2026-11-01T10:00:00Z',
})
const target = (id: string): ChatPhoto => ({ id, alt: id, url: null, full: photo(id) })
const tick = () => new Promise((r) => setTimeout(r, 0))

function setup(fetchBlob?: (url: string, max: number) => Promise<Blob>) {
  const budget = new AssetBudget(10 * 1024 * 1024)
  const live = new Set<string>()
  let n = 0
  let changes = 0
  const thumbs = new ChatThumbs({
    budget,
    fetchBlob: fetchBlob ?? (async (_u, max) => new Blob([new Uint8Array(max - 1)])),
    makeUrl: () => {
      const u = `blob:${n++}`
      live.add(u)
      return u
    },
    revokeUrl: (u) => void live.delete(u),
    onChange: () => void changes++,
  })
  return { budget, live, thumbs, changes: () => changes }
}

test('show загружает миниатюру, кладёт URL в строку и сообщает об изменении', async () => {
  const t = setup()
  const a = target('a')
  t.thumbs.show(a, photo('a'))
  await tick()
  expect(a.url).toBe('blob:0')
  expect(t.budget.used).toBe(99)
  expect(t.changes()).toBe(1)
})

test('больше CHAT_THUMB_MAX миниатюр не держим: самая старая заменяется текстом', async () => {
  const t = setup()
  const lines = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(target)
  for (const l of lines) {
    t.thumbs.show(l, photo(l.id))
    await tick()
  }
  expect(CHAT_THUMB_MAX).toBe(6)
  expect(lines.map((l) => l.url !== null)).toEqual([false, true, true, true, true, true, true])
  expect(t.live.size).toBe(6)
  expect(t.budget.used).toBe(6 * 99)
})

test('suspend освобождает всё, а resume подгружает и прежние, и пришедшие за время паузы фото', async () => {
  const t = setup()
  const a = target('a')
  t.thumbs.show(a, photo('a'))
  await tick()
  t.thumbs.suspend()
  expect(a.url).toBeNull()
  expect(t.budget.used).toBe(0)
  expect(t.live.size).toBe(0)
  const b = target('b')
  t.thumbs.show(b, photo('b'))
  await tick()
  expect(b.url).toBeNull()
  expect(t.budget.used).toBe(0)
  t.thumbs.resume()
  await tick()
  expect(a.url).not.toBeNull()
  expect(b.url).not.toBeNull()
  expect(t.budget.used).toBe(2 * 99)
})

test('за время паузы запоминаются только последние CHAT_THUMB_MAX фото', async () => {
  const t = setup()
  t.thumbs.suspend()
  const lines = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(target)
  for (const l of lines) t.thumbs.show(l, photo(l.id))
  t.thumbs.resume()
  await tick()
  expect(lines.map((l) => l.url !== null)).toEqual([false, true, true, true, true, true, true])
})

test('ошибка загрузки освобождает резерв и оставляет строку без картинки', async () => {
  const t = setup(async () => {
    throw new Error('сеть')
  })
  const a = target('a')
  t.thumbs.show(a, photo('a'))
  await tick()
  expect(a.url).toBeNull()
  expect(t.budget.used).toBe(0)
})

test('releaseAll во время загрузки: после ответа нет URL и резерва', async () => {
  let resolve!: (b: Blob) => void
  const t = setup(() => new Promise<Blob>((r) => (resolve = r)))
  const a = target('a')
  t.thumbs.show(a, photo('a'))
  t.thumbs.releaseAll()
  resolve(new Blob([new Uint8Array(50)]))
  await tick()
  expect(a.url).toBeNull()
  expect(t.budget.used).toBe(0)
  expect(t.live.size).toBe(0)
})

test('то же фото в чате второй раз заменяет прежнюю строку, а не ломает бюджет', async () => {
  const t = setup()
  const first = target('a')
  const second = target('a')
  t.thumbs.show(first, photo('a'))
  await tick()
  t.thumbs.show(second, photo('a'))
  await tick()
  expect(first.url).toBeNull()
  expect(second.url).not.toBeNull()
  expect(t.budget.used).toBe(99)
  expect(t.live.size).toBe(1)
})
