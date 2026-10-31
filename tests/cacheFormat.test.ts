import { expect, test } from 'bun:test'
import { formatCache, formatMemory } from '../src/ui/cacheFormat'

const MIB = 1024 * 1024

test('процент считается от всего мира, лимит виден рядом', () => {
  expect(formatCache(1.2 * MIB, 47 * MIB, 4.7 * MIB)).toBe('Кеш: 2,6% мира (1,2 / 47,0 МБ, лимит 10%)')
})

test('ноль', () => {
  expect(formatCache(0, 42 * MIB, 4.2 * MIB)).toBe('Кеш: 0,0% мира (0,0 / 42,0 МБ, лимит 10%)')
})

test('превышение лимита видно по проценту', () => {
  expect(formatCache(5 * MIB, 42 * MIB, 4.2 * MIB).startsWith('Кеш: 11,9% мира')).toBe(true)
})

test('строка памяти', () => {
  expect(formatMemory(6, 41)).toBe('Текстуры: 6 · Геометрии: 41')
})
