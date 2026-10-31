import { expect, test } from 'bun:test'
import { ChatLog, chatLineText, validateChatText } from '../src/ui/chatLog'

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
  for (let i = 0; i < 105; i++) log.push({ id: String(i), author: 'a', color: null, text: 't' })
  expect(log.lines.length).toBe(100)
  expect(log.lines[0].id).toBe('5')
  log.clear()
  expect(log.lines.length).toBe(0)
})

test('сообщение только с фото', () => {
  expect(chatLineText('', true)).toBe('[фото]')
  expect(chatLineText('подпись', true)).toBe('подпись')
})
