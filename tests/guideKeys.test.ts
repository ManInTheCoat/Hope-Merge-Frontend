import { expect, test } from 'bun:test'
import { panelKeyAction } from '../src/ui/guideKeys'

const ctx = { typing: false, inputDisabled: false, opening: false }

test('Esc панель не закрывает: браузер не даст снова захватить мышь, игрок попал бы на затемнение', () => {
  expect(panelKeyAction('Escape', ctx)).toBeNull()
  expect(panelKeyAction('Escape', { ...ctx, typing: true })).toBeNull()
})

test('E вне поля закрывает панель', () => {
  expect(panelKeyAction('KeyE', ctx)).toBe('close')
})

test('E в поле — это буква', () => {
  expect(panelKeyAction('KeyE', { ...ctx, typing: true })).toBeNull()
})

test('нажатие E, которое открыло панель, её не закрывает', () => {
  expect(panelKeyAction('KeyE', { ...ctx, opening: true })).toBeNull()
})

test('пока гид отвечает и поле заблокировано, E закрывает: печатать всё равно нельзя', () => {
  expect(panelKeyAction('KeyE', { ...ctx, inputDisabled: true })).toBe('close')
})

test('прочие клавиши ничего не делают', () => {
  expect(panelKeyAction('KeyW', ctx)).toBeNull()
})
