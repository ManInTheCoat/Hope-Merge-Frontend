import { expect, test } from 'bun:test'
import { ContentError } from '../src/network/api'
import { AssetBudget } from '../src/world/AssetBudget'

test('reserve увеличивает used', () => {
  const b = new AssetBudget(100)
  b.reserve('a', 30)
  expect(b.used).toBe(30)
  expect(b.limit).toBe(100)
})

test('reserve сверх лимита — ContentError без записи', () => {
  const b = new AssetBudget(100)
  b.reserve('a', 60)
  expect(() => b.reserve('b', 50)).toThrow(ContentError)
  expect(b.used).toBe(60)
  b.reserve('c', 40)
  expect(b.used).toBe(100)
})

test('settle заменяет резерв без двойного счёта', () => {
  const b = new AssetBudget(100)
  b.reserve('a', 30)
  b.settle('a', 25)
  expect(b.used).toBe(25)
})

test('release снимает запись, повторный release — no-op', () => {
  const b = new AssetBudget(100)
  b.reserve('a', 30)
  b.release('a')
  expect(b.used).toBe(0)
  b.release('a')
  expect(b.used).toBe(0)
})

test('повторный reserve того же ключа — ошибка', () => {
  const b = new AssetBudget(100)
  b.reserve('a', 30)
  expect(() => b.reserve('a', 10)).toThrow()
  expect(b.used).toBe(30)
})

test('settle неизвестного ключа — ошибка', () => {
  const b = new AssetBudget(100)
  expect(() => b.settle('x', 1)).toThrow()
})

test('onChange вызывается на reserve/settle/release и отписывается', () => {
  const b = new AssetBudget(100)
  const seen: number[] = []
  const off = b.onChange((used, limit) => {
    expect(limit).toBe(100)
    seen.push(used)
  })
  b.reserve('a', 30)
  b.settle('a', 25)
  b.release('a')
  expect(seen).toEqual([30, 25, 0])
  off()
  b.reserve('b', 5)
  expect(seen).toEqual([30, 25, 0])
})
