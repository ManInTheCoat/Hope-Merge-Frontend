import { expect, test } from 'bun:test'
import { checkPhotoForm, photoFingerprint } from '../src/network/mock/photoForm'

const form = (entries: [string, string | Blob][]) => {
  const f = new FormData()
  entries.forEach(([k, v]) => f.append(k, v))
  return f
}
const image: [string, Blob] = ['image', new Blob(['x'], { type: 'image/jpeg' })]
const ok: [string, string | Blob][] = [image, ['room_id', 'r1'], ['movement_epoch', '1']]

test('правильная форма проходит, в том числе с caption и exhibit_id', () => {
  expect(checkPhotoForm(form(ok))).toBeNull()
  expect(checkPhotoForm(form([...ok, ['caption', ''], ['exhibit_id', 'e1']]))).toBeNull()
})

test('неизвестное поле отклоняется', () => {
  expect(checkPhotoForm(form([...ok, ['foo', '1']]))).not.toBeNull()
})

test('повтор поля отклоняется', () => {
  expect(checkPhotoForm(form([...ok, ['room_id', 'r2']]))).not.toBeNull()
  expect(checkPhotoForm(form([...ok, image]))).not.toBeNull()
})

test('нет обязательного поля — отклоняется', () => {
  expect(checkPhotoForm(form([['room_id', 'r1'], ['movement_epoch', '1']]))).not.toBeNull()
  expect(checkPhotoForm(form([image, ['movement_epoch', '1']]))).not.toBeNull()
  expect(checkPhotoForm(form([image, ['room_id', 'r1']]))).not.toBeNull()
})

test('epoch не десятичное целое — отклоняется', () => {
  for (const bad of ['1.5', '', 'abc', '-1', '1e2']) {
    expect(checkPhotoForm(form([image, ['room_id', 'r1'], ['movement_epoch', bad]]))).not.toBeNull()
  }
})

test('image строкой, а не файлом — отклоняется', () => {
  expect(checkPhotoForm(form([['image', 'x'], ['room_id', 'r1'], ['movement_epoch', '1']]))).not.toBeNull()
})

test('отпечаток различает файл и поля', () => {
  expect(photoFingerprint(form(ok))).toBe(photoFingerprint(form(ok)))
  expect(photoFingerprint(form([...ok, ['exhibit_id', 'e1']]))).not.toBe(photoFingerprint(form(ok)))
  const bigger: [string, Blob] = ['image', new Blob(['xyz'], { type: 'image/jpeg' })]
  expect(photoFingerprint(form([bigger, ok[1], ok[2]]))).not.toBe(photoFingerprint(form(ok)))
})
