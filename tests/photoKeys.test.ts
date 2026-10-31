import { expect, test } from 'bun:test'
import { photoKeyAction } from '../src/photo/keys'

test('F снимает, G скачивает', () => {
  const ctx = { typing: false, canShoot: true, hasPhoto: true }
  expect(photoKeyAction('KeyF', ctx)).toBe('shoot')
  expect(photoKeyAction('KeyG', ctx)).toBe('download')
})

test('в поле ввода F и G — буквы', () => {
  const ctx = { typing: true, canShoot: true, hasPhoto: true }
  expect(photoKeyAction('KeyF', ctx)).toBeNull()
  expect(photoKeyAction('KeyG', ctx)).toBeNull()
})

test('F без права снимать и G без снимка ничего не делают', () => {
  const ctx = { typing: false, canShoot: false, hasPhoto: false }
  expect(photoKeyAction('KeyF', ctx)).toBeNull()
  expect(photoKeyAction('KeyG', ctx)).toBeNull()
})

test('прочие клавиши ничего не делают', () => {
  expect(photoKeyAction('KeyW', { typing: false, canShoot: true, hasPhoto: true })).toBeNull()
})
