import { expect, test } from 'bun:test'
import { codePoints, trimWs, validateText } from '../src/ui/text'

test('validateText: обрезка по краям, пустое и длинное → null', () => {
  expect(validateText('  ab ', 500)).toBe('ab')
  expect(validateText('   ', 500)).toBeNull()
  expect(validateText('x'.repeat(500), 500)).toBe('x'.repeat(500))
  expect(validateText('x'.repeat(501), 500)).toBeNull()
})

test('codePoints считает кодовые точки, а не UTF-16', () => {
  expect(codePoints('😀a')).toBe(2)
})

test('trimWs обрезает Unicode White_Space', () => {
  expect(trimWs('  x  ')).toBe('x')
})
