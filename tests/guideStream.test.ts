import { expect, test } from 'bun:test'
import { StreamText } from '../src/ui/guideStream'

test('куски по порядку склеиваются', () => {
  const s = new StreamText()
  s.push(0, 'При')
  s.push(1, 'вет')
  expect(s.text).toBe('Привет')
})

test('кусок после дыры не виден, пока дыру не закроют', () => {
  const s = new StreamText()
  s.push(0, 'a')
  s.push(2, 'c')
  expect(s.text).toBe('a')
  expect(s.hasGap).toBe(true)
  s.push(1, 'b')
  expect(s.text).toBe('abc')
  expect(s.hasGap).toBe(false)
})

test('повтор index игнорируется', () => {
  const s = new StreamText()
  s.push(0, 'a')
  s.push(0, 'X')
  expect(s.text).toBe('a')
})

test('отрицательный и дробный index игнорируются', () => {
  const s = new StreamText()
  s.push(-1, 'x')
  s.push(0.5, 'y')
  expect(s.text).toBe('')
  expect(s.hasGap).toBe(false)
})
