import { expect, test } from 'bun:test'
import { clipForSpeed, guideLook, MODEL_IDS, pickModel } from '../src/characters/catalog'

test('pickModel: один ключ — одна модель, разные ключи покрывают пак', () => {
  expect(pickModel('u1')).toBe(pickModel('u1'))
  const seen = new Set(Array.from({ length: 50 }, (_, i) => pickModel(`user-${i}`)))
  expect(seen.size).toBeGreaterThanOrEqual(6)
  for (const m of seen) expect(MODEL_IDS).toContain(m)
})

test('guideLook: по id, по имени без регистра, незнакомый — null', () => {
  expect(guideLook('guide_monet', 'x')?.accessories).toContain('boater')
  expect(guideLook('g7', 'Леонардо да Винчи')?.accessories).toContain('beret')
  expect(guideLook('g8', 'ВИНСЕНТ ВАН ГОГ')).not.toBeNull()
  expect(guideLook('guide_herodotus', 'Геродот')).toBeNull()
})

test('clipForSpeed: стоит, идёт, бежит; телепорт — стоит', () => {
  expect(clipForSpeed(0)).toBe('idle')
  expect(clipForSpeed(1.5)).toBe('walk')
  expect(clipForSpeed(3.6)).toBe('sprint')
  expect(clipForSpeed(40)).toBe('idle')
})
