import { expect, test } from 'bun:test'
import { AlbumPager } from '../src/album/albumPager'
import type { Photo, PhotosPage } from '../src/network/contract'

export const photo = (id: string): Photo => ({
  id,
  owner_id: 'u',
  caption: id,
  room_id: 'r',
  exhibit_id: null,
  published: false,
  image_url: `/api/v1/photos/${id}/image`,
  image_bytes: 10,
  thumbnail_url: `/api/v1/photos/${id}/thumbnail`,
  thumbnail_bytes: 5,
  width: 1,
  height: 1,
  created_at: '2026-11-01T10:00:00Z',
})

function server(pages: string[][]) {
  const calls: (string | null)[] = []
  const fetchPage = async (cursor: string | null): Promise<PhotosPage> => {
    calls.push(cursor)
    const i = cursor === null ? 0 : Number(cursor)
    return { items: pages[i].map(photo), next_cursor: i + 1 < pages.length ? String(i + 1) : null }
  }
  return { fetchPage, calls }
}

test('first, next, prev ходят по страницам и показывают текущую', async () => {
  const s = server([['a', 'b'], ['c', 'd'], ['e']])
  const p = new AlbumPager(s.fetchPage)
  expect((await p.first()).map((x) => x.id)).toEqual(['a', 'b'])
  expect([p.hasPrev, p.hasNext]).toEqual([false, true])
  expect((await p.next()).map((x) => x.id)).toEqual(['c', 'd'])
  expect([p.hasPrev, p.hasNext]).toEqual([true, true])
  await p.next()
  expect([p.hasPrev, p.hasNext]).toEqual([true, false])
  expect((await p.prev()).map((x) => x.id)).toEqual(['c', 'd'])
  expect((await p.prev()).map((x) => x.id)).toEqual(['a', 'b'])
  expect(s.calls).toEqual([null, '1', '2', '1', null])
})

test('next на последней и prev на первой странице не делают запросов', async () => {
  const s = server([['a']])
  const p = new AlbumPager(s.fetchPage)
  await p.first()
  await p.next()
  await p.prev()
  expect(s.calls).toEqual([null])
  expect(p.items.map((x) => x.id)).toEqual(['a'])
})

test('ошибка загрузки оставляет прежнюю страницу и возможность повторить', async () => {
  const s = server([['a'], ['b']])
  let fail = true
  const p = new AlbumPager(async (c) => {
    if (c === '1' && fail) throw new Error('boom')
    return s.fetchPage(c)
  })
  await p.first()
  await expect(p.next()).rejects.toThrow('boom')
  expect(p.items.map((x) => x.id)).toEqual(['a'])
  expect(p.hasNext).toBe(true)
  fail = false
  expect((await p.next()).map((x) => x.id)).toEqual(['b'])
})

test('replace подменяет фото с тем же id', async () => {
  const p = new AlbumPager(server([['a', 'b']]).fetchPage)
  await p.first()
  p.replace({ ...photo('b'), published: true })
  expect(p.items.map((x) => x.published)).toEqual([false, true])
})
