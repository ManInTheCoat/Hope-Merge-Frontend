import { expect, test } from 'bun:test'
import { formatCache, formatMemory } from '../src/ui/cacheFormat'

test('пример из плана', () => {
  expect(formatCache(3_460_301, 44_040_192)).toBe('Кеш: 7,9% (3,3 / 42,0 МБ)')
})

test('ноль', () => {
  expect(formatCache(0, 4_404_019)).toBe('Кеш: 0,0% (0,0 / 4,2 МБ)')
})

test('больше 100%', () => {
  expect(formatCache(5_000_000, 4_404_019).startsWith('Кеш: 113,5%')).toBe(true)
})

test('строка памяти', () => {
  expect(formatMemory(6, 41)).toBe('Текстуры: 6 · Геометрии: 41')
})
