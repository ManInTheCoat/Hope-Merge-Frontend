import { expect, test } from 'bun:test'
import { AlbumController, type AlbumState } from '../src/album/albumController'
import { ContentError } from '../src/network/api'
import type { Photo, PhotosPage } from '../src/network/contract'
import { AssetBudget } from '../src/world/AssetBudget'

const photo = (id: string): Photo => ({
  id,
  owner_id: 'u',
  caption: id,
  room_id: 'r',
  exhibit_id: null,
  published: false,
  image_url: `/i/${id}`,
  image_bytes: 1000,
  thumbnail_url: `/t/${id}`,
  thumbnail_bytes: 100,
  width: 1,
  height: 1,
  created_at: '2026-11-01T10:00:00Z',
})

type Opts = {
  pages?: string[][]
  failPage?: (cursor: string | null) => boolean
  fetchBlob?: (url: string, max: number) => Promise<Blob>
}

function setup(o: Opts = {}) {
  const pages = o.pages ?? [['a', 'b'], ['c']]
  const budget = new AssetBudget(10 * 1024 * 1024)
  const live = new Set<string>()
  const states: AlbumState[] = []
  let n = 0
  const c = new AlbumController(
    {
      fetchPage: async (cursor): Promise<PhotosPage> => {
        if (o.failPage?.(cursor)) throw new Error('SOCKET_CLOSED:1006')
        const i = cursor === null ? 0 : Number(cursor)
        return { items: pages[i].map(photo), next_cursor: i + 1 < pages.length ? String(i + 1) : null }
      },
      fetchBlob: o.fetchBlob ?? (async (_u, max) => new Blob([new Uint8Array(max - 1)])),
      budget,
      makeUrl: () => {
        const u = `blob:${n++}`
        live.add(u)
        return u
      },
      revokeUrl: (u) => void live.delete(u),
    },
    (s) => states.push(s),
  )
  const last = () => states[states.length - 1]
  return { c, budget, live, states, last }
}

const deferred = () => {
  let resolve!: (b: Blob) => void
  const promise = new Promise<Blob>((r) => (resolve = r))
  return { promise, resolve }
}

test('open: загрузка, затем сетка с миниатюрами', async () => {
  const t = setup()
  await t.c.open()
  expect(t.states[0].kind).toBe('loading')
  const s = t.last()
  if (s.kind !== 'grid') throw new Error('нужна сетка')
  expect(s.items.map((p) => p.id)).toEqual(['a', 'b'])
  expect([...s.thumbs.keys()]).toEqual(['a', 'b'])
  expect([s.hasPrev, s.hasNext, s.busy, s.notice]).toEqual([false, true, false, null])
})

test('пустой альбом — сетка без фото и без ошибки', async () => {
  const t = setup({ pages: [[]] })
  await t.c.open()
  const s = t.last()
  expect(s.kind).toBe('grid')
  if (s.kind === 'grid') expect(s.items).toEqual([])
})

test('ошибка первой страницы: текст без технического кода, повтор open снова даёт сетку', async () => {
  let fail = true
  const t = setup({ failPage: () => fail })
  await t.c.open()
  const e = t.last()
  expect(e.kind).toBe('error')
  if (e.kind === 'error') expect(e.text).not.toContain('SOCKET_CLOSED')
  fail = false
  await t.c.open()
  expect(t.last().kind).toBe('grid')
})

test('ошибка next оставляет прежнюю сетку и сообщает', async () => {
  const t = setup({ failPage: (c) => c === '1' })
  await t.c.open()
  await t.c.next()
  const s = t.last()
  if (s.kind !== 'grid') throw new Error('нужна сетка')
  expect(s.items.map((p) => p.id)).toEqual(['a', 'b'])
  expect(s.busy).toBe(false)
  expect(s.notice).not.toBeNull()
})

test('next и prev меняют страницы, освобождая прежние миниатюры', async () => {
  const t = setup()
  await t.c.open()
  await t.c.next()
  let s = t.last()
  if (s.kind !== 'grid') throw new Error('нужна сетка')
  expect(s.items.map((p) => p.id)).toEqual(['c'])
  expect(t.live.size).toBe(1)
  await t.c.prev()
  s = t.last()
  if (s.kind !== 'grid') throw new Error('нужна сетка')
  expect(s.items.map((p) => p.id)).toEqual(['a', 'b'])
  expect(t.live.size).toBe(2)
})

test('второй next, пока идёт первый, игнорируется', async () => {
  const t = setup({ pages: [['a'], ['b'], ['c']] })
  await t.c.open()
  await Promise.all([t.c.next(), t.c.next()])
  const s = t.last()
  if (s.kind !== 'grid') throw new Error('нужна сетка')
  expect(s.items.map((p) => p.id)).toEqual(['b'])
})

test('view: просмотр без URL, затем с URL; backToGrid возвращает страницу и освобождает оригинал', async () => {
  const t = setup()
  await t.c.open()
  await t.c.view('b')
  const v = t.last()
  if (v.kind !== 'viewer') throw new Error('нужен просмотр')
  expect(t.states.some((s) => s.kind === 'viewer' && s.url === null)).toBe(true)
  expect(v.url).not.toBeNull()
  expect(t.c.isViewer).toBe(true)
  expect(t.c.viewed?.photo.id).toBe('b')
  t.c.backToGrid()
  const g = t.last()
  if (g.kind !== 'grid') throw new Error('нужна сетка')
  expect([...g.thumbs.keys()]).toEqual(['a', 'b'])
  expect(t.c.viewed).toBeNull()
  expect(t.budget.used).toBe(99 + 99)
})

test('оригинал больше объявленного: возврат в сетку с сообщением, ключ просмотра свободен', async () => {
  const t = setup({
    fetchBlob: async (url, max) => {
      if (url.startsWith('/i/')) throw new ContentError('больше объявленного')
      return new Blob([new Uint8Array(max)])
    },
  })
  await t.c.open()
  await t.c.view('a')
  const s = t.last()
  if (s.kind !== 'grid') throw new Error('нужна сетка')
  expect(s.notice).not.toBeNull()
  expect(t.budget.used).toBe(200)
})

test('close во время загрузки страницы: бюджет пуст и состояний больше нет', async () => {
  const gate = deferred()
  const t = setup({ fetchBlob: () => gate.promise })
  const opening = t.c.open()
  await Promise.resolve()
  await Promise.resolve()
  t.c.close()
  const count = t.states.length
  gate.resolve(new Blob([new Uint8Array(50)]))
  await opening
  expect(t.states.length).toBe(count)
  expect(t.budget.used).toBe(0)
  expect(t.live.size).toBe(0)
})

test('close во время загрузки оригинала: бюджет пуст, URL отозваны', async () => {
  const gate = deferred()
  let heldBack = false
  const t = setup({
    fetchBlob: (url, max) => {
      if (url.startsWith('/i/')) {
        heldBack = true
        return gate.promise
      }
      return Promise.resolve(new Blob([new Uint8Array(max)]))
    },
  })
  await t.c.open()
  const viewing = t.c.view('a')
  expect(heldBack).toBe(true)
  t.c.close()
  const count = t.states.length
  gate.resolve(new Blob([new Uint8Array(500)]))
  await viewing
  expect(t.states.length).toBe(count)
  expect(t.budget.used).toBe(0)
  expect(t.live.size).toBe(0)
})

test('markPublished отмечает фото в сетке и в просмотре', async () => {
  const t = setup()
  await t.c.open()
  await t.c.view('a')
  t.c.markPublished('a')
  const v = t.last()
  if (v.kind !== 'viewer') throw new Error('нужен просмотр')
  expect(v.photo.published).toBe(true)
  expect(v.url).not.toBeNull()
  t.c.backToGrid()
  const g = t.last()
  if (g.kind !== 'grid') throw new Error('нужна сетка')
  expect(g.items.find((p) => p.id === 'a')?.published).toBe(true)
})

test('openSingle: просмотр одного фото без страниц, backToGrid ничего не делает, close освобождает бюджет', async () => {
  const t = setup()
  await t.c.openSingle(photo('z'))
  const v = t.last()
  if (v.kind !== 'viewer') throw new Error('нужен просмотр')
  expect([v.photo.id, v.single, v.url !== null]).toEqual(['z', true, true])
  expect(t.states.some((s) => s.kind === 'viewer' && s.url === null)).toBe(true)
  expect(t.c.isSingle).toBe(true)
  const count = t.states.length
  t.c.backToGrid()
  expect(t.states.length).toBe(count)
  t.c.close()
  expect(t.budget.used).toBe(0)
  expect(t.live.size).toBe(0)
  expect(t.c.isSingle).toBe(false)
})

test('openSingle: ошибка оригинала даёт error, retry пробует то же фото снова', async () => {
  let fail = true
  const t = setup({
    fetchBlob: async (_u, max) => {
      if (fail) throw new ContentError('больше объявленного')
      return new Blob([new Uint8Array(max - 1)])
    },
  })
  await t.c.openSingle(photo('z'))
  expect(t.last().kind).toBe('error')
  expect(t.budget.used).toBe(0)
  fail = false
  await t.c.retry()
  const v = t.last()
  expect(v.kind === 'viewer' && v.photo.id === 'z' && v.url !== null).toBe(true)
})

test('retry без одиночного просмотра заново открывает альбом', async () => {
  const t = setup()
  await t.c.retry()
  expect(t.last().kind).toBe('grid')
})
