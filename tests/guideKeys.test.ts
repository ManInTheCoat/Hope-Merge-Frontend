import { expect, test } from 'bun:test'
import { panelKeyAction } from '../src/ui/guideKeys'

const ctx = { typing: false, inputDisabled: false, opening: false }

test('Esc закрывает панель без захвата мыши', () => {
  expect(panelKeyAction('Escape', ctx)).toBe('close')
  expect(panelKeyAction('Escape', { ...ctx, typing: true, inputDisabled: true })).toBe('close')
})

test('E вне поля закрывает и захватывает мышь', () => {
  expect(panelKeyAction('KeyE', ctx)).toBe('close-lock')
})

test('E в поле — это буква', () => {
  expect(panelKeyAction('KeyE', { ...ctx, typing: true })).toBeNull()
})

test('нажатие E, которое открыло панель, её не закрывает', () => {
  expect(panelKeyAction('KeyE', { ...ctx, opening: true })).toBeNull()
})

test('пока поле заблокировано ответом, E не закрывает: игрок начал набирать следующий вопрос', () => {
  expect(panelKeyAction('KeyE', { ...ctx, inputDisabled: true })).toBeNull()
})

test('прочие клавиши ничего не делают', () => {
  expect(panelKeyAction('KeyW', ctx)).toBeNull()
})
