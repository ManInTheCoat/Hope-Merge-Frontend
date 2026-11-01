import { expect, test } from 'bun:test'
import { AlbumImages, thumbKey, VIEW_KEY } from '../src/album/albumImages'
import { ContentError } from '../src/network/api'
import type { Photo } from '../src/network/contract'
import { AssetBudget } from '../src/world/AssetBudget'

const MiB = 1024 * 1024
const photo = (id: string, thumbBytes = 100, imageBytes = 1000): Photo => ({
  id,
  owner_id: 'u',
  caption: '',
  room_id: 'r',
  exhibit_id: null,
  published: false,
  image_url: `/i/${id}`,
  image_bytes: imageBytes,
  thumbnail_url: `/t/${id}`,
  thumbnail_bytes: thumbBytes,
  width: 1,
  height: 1,
  created_at: '2026-11-01T10:00:00Z',
})

function setup(fetchBlob?: (url: string, max: number, signal?: AbortSignal) => Promise<Blob>) {
  const budget = new AssetBudget(10 * MiB)
  const live = new Set<string>()
  let n = 0
  const images = new AlbumImages({
    budget,
    fetchBlob: fetchBlob ?? (async (_url, max) => new Blob([new Uint8Array(max - 1)])),
    makeUrl: (b) => {
      const u = `blob:${n++}:${b.size}`
      live.add(u)
      return u
    },
    revokeUrl: (u) => void live.delete(u),
  })
  return { budget, images, live }
}

const deferred = () => {
  let resolve!: (b: Blob) => void
  const promise = new Promise<Blob>((r) => (resolve = r))
  return { promise, resolve }
}

test('loadThumbs учитывает фактические размеры под ключами photo:thumb:<id>', async () => {
  const { budget, images, live } = setup()
  const urls = await images.loadThumbs([photo('a'), photo('b')])
  expect([...urls.keys()]).toEqual(['a', 'b'])
  expect(budget.used).toBe(99 + 99)
  expect(live.size).toBe(2)
  expect(thumbKey('a')).toBe('photo:thumb:a')
})

test('повторный loadThumbs освобождает прежние миниатюры', async () => {
  const { budget, images, live } = setup()
  await images.loadThumbs([photo('a'), photo('b')])
  await images.loadThumbs([photo('c')])
  expect(budget.used).toBe(99)
  expect(live.size).toBe(1)
})

test('миниатюра, превысившая объявленное или не загрузившаяся, пропускается, резерв освобождён', async () => {
  const { budget, images } = setup(async (url, max) => {
    if (url === '/t/bad') throw new ContentError('больше объявленного')
    if (url === '/t/down') throw new Error('сеть')
    return new Blob([new Uint8Array(max)])
  })
  const urls = await images.loadThumbs([photo('ok'), photo('bad'), photo('down')])
  expect([...urls.keys()]).toEqual(['ok'])
  expect(budget.used).toBe(100)
})

test('устаревший loadThumbs не оставляет миниатюр в бюджете', async () => {
  const first = deferred()
  let call = 0
  const { budget, images, live } = setup((_url, max) => (call++ === 0 ? first.promise : Promise.resolve(new Blob([new Uint8Array(max)]))))
  const stale = images.loadThumbs([photo('old')])
  const fresh = await images.loadThumbs([photo('new')])
  first.resolve(new Blob([new Uint8Array(100)]))
  expect((await stale).size).toBe(0)
  expect([...fresh.keys()]).toEqual(['new'])
  expect(budget.used).toBe(100)
  expect(live.size).toBe(1)
})

test('openOriginal резервирует image_bytes под photo:view, затем фактический размер', async () => {
  const gate = deferred()
  const { budget, images } = setup(() => gate.promise)
  const p = images.openOriginal(photo('a', 100, 5000))
  expect(budget.used).toBe(5000)
  gate.resolve(new Blob([new Uint8Array(4000)]))
  const { url, blob } = await p
  expect(budget.used).toBe(4000)
  expect(blob.size).toBe(4000)
  expect(url.startsWith('blob:')).toBe(true)
  expect(VIEW_KEY).toBe('photo:view')
})

test('новый openOriginal освобождает прежний оригинал', async () => {
  const { budget, images, live } = setup()
  await images.openOriginal(photo('a', 100, 5000))
  await images.openOriginal(photo('b', 100, 3000))
  expect(budget.used).toBe(2999)
  expect(live.size).toBe(1)
})

test('оригинал больше объявленного: ContentError, ключ свободен', async () => {
  const { budget, images, live } = setup(async () => {
    throw new ContentError('больше объявленного')
  })
  await expect(images.openOriginal(photo('a'))).rejects.toBeInstanceOf(ContentError)
  expect(budget.used).toBe(0)
  expect(live.size).toBe(0)
})

test('closeOriginal во время загрузки: после завершения нет URL и резерва, вызов отклонён', async () => {
  const gate = deferred()
  const { budget, images, live } = setup(() => gate.promise)
  const p = images.openOriginal(photo('a'))
  images.closeOriginal()
  gate.resolve(new Blob([new Uint8Array(500)]))
  await expect(p).rejects.toThrow()
  expect(budget.used).toBe(0)
  expect(live.size).toBe(0)
})

test('releaseAll обнуляет бюджет и отзывает все URL', async () => {
  const { budget, images, live } = setup()
  await images.loadThumbs([photo('a'), photo('b')])
  await images.openOriginal(photo('c'))
  images.releaseAll()
  expect(budget.used).toBe(0)
  expect(live.size).toBe(0)
})
