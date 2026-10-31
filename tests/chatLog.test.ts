import { expect, test } from 'bun:test'
import { ChatLog, chatKeyAction, chatLineText, validateChatText } from '../src/ui/chatLog'

test('пустое и пробельное сообщение не отправляется', () => {
  expect(validateChatText('')).toBeNull()
  expect(validateChatText('   ')).toBeNull()
})

test('обрезается по краям', () => {
  expect(validateChatText('  привет \n')).toBe('привет')
})

test('500 эмодзи допустимы, 501 — нет', () => {
  expect(validateChatText('😀'.repeat(500))).not.toBeNull()
  expect(validateChatText('😀'.repeat(501))).toBeNull()
})

test('лента хранит последние 100', () => {
  const log = new ChatLog()
  for (let i = 0; i < 105; i++) log.push({ author: 'a', color: null, text: String(i) })
  expect(log.lines.length).toBe(100)
  expect(log.lines[0].text).toBe('5')
  log.clear()
  expect(log.lines.length).toBe(0)
})

test('сообщение только с фото', () => {
  expect(chatLineText('', true)).toBe('[фото]')
  expect(chatLineText('подпись', true)).toBe('подпись')
})

const ctx = { chatOpen: false, typing: false, blocked: false }

test('Esc закрывает открытый чат, даже если фокус ушёл из поля', () => {
  expect(chatKeyAction('Escape', { ...ctx, chatOpen: true })).toBe('close')
})

test('Enter открывает чат только вне полей ввода и без помех', () => {
  expect(chatKeyAction('Enter', ctx)).toBe('open')
  expect(chatKeyAction('NumpadEnter', ctx)).toBe('open')
  expect(chatKeyAction('Enter', { ...ctx, typing: true })).toBeNull()
  expect(chatKeyAction('Enter', { ...ctx, blocked: true })).toBeNull()
  expect(chatKeyAction('Enter', { ...ctx, chatOpen: true })).toBeNull()
  expect(chatKeyAction('Escape', ctx)).toBeNull()
})
