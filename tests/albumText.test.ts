import { expect, test } from 'bun:test'
import { albumFileName, photoMeta, shareBlockReason } from '../src/album/albumText'
import type { Photo } from '../src/network/contract'

const photo = (caption = ''): Photo => ({
  id: 'p1',
  owner_id: 'u',
  caption,
  room_id: 'hall_antiquity',
  exhibit_id: null,
  published: false,
  image_url: '/i',
  image_bytes: 1,
  thumbnail_url: '/t',
  thumbnail_bytes: 1,
  width: 1,
  height: 1,
  created_at: '2026-11-01T10:05:00Z',
})

test('photoMeta: пустая подпись заменяется, зал и дата показываются', () => {
  const m = photoMeta(photo(), 'UTC')
  expect(m.caption).toBe('Без подписи')
  expect(m.room).toBe('hall_antiquity')
  expect(m.date).toContain('10:05')
  expect(m.date).toContain('2026')
  expect(photoMeta(photo('Ваза'), 'UTC').caption).toBe('Ваза')
})

test('shareBlockReason: причина, пока игра не готова или сокет закрыт', () => {
  expect(shareBlockReason({ ready: true, socketOpen: true })).toBeNull()
  expect(shareBlockReason({ ready: false, socketOpen: true })).toBe('Отправка в чат доступна, когда игра подключена')
  expect(shareBlockReason({ ready: true, socketOpen: false })).toBe('Отправка в чат доступна, когда игра подключена')
})

test('albumFileName строится из зала и времени снимка', () => {
  expect(albumFileName(photo())).toMatch(/^museum-hall_antiquity-\d{8}-\d{6}\.jpg$/)
})
