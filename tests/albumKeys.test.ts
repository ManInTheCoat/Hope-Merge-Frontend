import { expect, test } from 'bun:test'
import { albumKeyAction } from '../src/album/albumKeys'

const ctx = { typing: false, open: false, viewer: false, blocked: false }

test('B открывает закрытый альбом и закрывает открытый', () => {
  expect(albumKeyAction('KeyB', ctx)).toBe('open')
  expect(albumKeyAction('KeyB', { ...ctx, open: true })).toBe('close')
  expect(albumKeyAction('KeyB', { ...ctx, open: true, viewer: true })).toBe('close')
})

test('при блокировке или вводе текста B не открывает альбом', () => {
  expect(albumKeyAction('KeyB', { ...ctx, blocked: true })).toBeNull()
  expect(albumKeyAction('KeyB', { ...ctx, typing: true })).toBeNull()
  expect(albumKeyAction('KeyB', { ...ctx, typing: true, open: true })).toBeNull()
})

test('Escape в просмотре возвращает к сетке, в сетке закрывает, при закрытом альбоме не нужен', () => {
  expect(albumKeyAction('Escape', { ...ctx, open: true, viewer: true })).toBe('back')
  expect(albumKeyAction('Escape', { ...ctx, open: true })).toBe('close')
  expect(albumKeyAction('Escape', ctx)).toBeNull()
})

test('чужие клавиши игнорируются', () => {
  for (const code of ['KeyE', 'KeyF', 'KeyG', 'KeyQ', 'Enter']) expect(albumKeyAction(code, { ...ctx, open: true })).toBeNull()
})
