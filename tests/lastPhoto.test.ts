import { expect, test } from 'bun:test'
import { ContentError } from '../src/network/api'
import { LastPhoto, photoFileName } from '../src/photo/lastPhoto'
import { AssetBudget } from '../src/world/AssetBudget'

const MiB = 1024 * 1024
const bytes = (n: number) => new Blob([new Uint8Array(n)])

test('begin резервирует 2 МиБ, commit заменяет резерв фактическим размером', () => {
  const b = new AssetBudget(10 * MiB)
  const p = new LastPhoto(b)
  p.begin()
  expect(b.used).toBe(2 * MiB)
  p.commit(bytes(1000), 'r1', new Date(2026, 9, 31, 14, 5, 9))
  expect(b.used).toBe(1000)
  expect(p.url).not.toBeNull()
  expect(p.blob?.size).toBe(1000)
  expect(p.fileName).toBe('museum-r1-20261031-140509.jpg')
})

test('новый снимок освобождает прежний до резерва', () => {
  const b = new AssetBudget(2.5 * MiB)
  const p = new LastPhoto(b)
  p.begin()
  p.commit(bytes(MiB), 'r1', new Date())
  p.begin()
  expect(b.used).toBe(2 * MiB)
  expect(p.blob).toBeNull()
})

test('release освобождает бюджет и ссылку, повторный release безопасен', () => {
  const b = new AssetBudget(10 * MiB)
  const p = new LastPhoto(b)
  p.begin()
  p.commit(bytes(10), 'r1', new Date())
  p.release()
  p.release()
  expect(b.used).toBe(0)
  expect(p.url).toBeNull()
  expect(p.blob).toBeNull()
  expect(p.fileName).toBeNull()
})

test('нет места в бюджете → ContentError, прежний снимок уже освобождён', () => {
  const b = new AssetBudget(2 * MiB + 10)
  const p = new LastPhoto(b)
  p.begin()
  p.commit(bytes(10), 'r1', new Date())
  b.reserve('room', 2 * MiB) // зал вырос, пока лежало фото
  expect(() => p.begin()).toThrow(ContentError)
  expect(p.blob).toBeNull()
  expect(b.used).toBe(2 * MiB)
})

test('photoFileName дополняет нулями', () => {
  expect(photoFileName('hall_1', new Date(2026, 0, 2, 3, 4, 5))).toBe('museum-hall_1-20260102-030405.jpg')
})
