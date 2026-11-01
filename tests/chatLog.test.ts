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

test('сообщение только с фото: заглушка, пока картинки нет', () => {
  const photo = { id: 'p', alt: '', url: null as string | null, full: {} as never }
  expect(chatLineText('', photo)).toBe('[фото]')
  expect(chatLineText('подпись', photo)).toBe('подпись')
  photo.url = 'blob:1'
  expect(chatLineText('', photo)).toBe('')
  expect(chatLineText('подпись', photo)).toBe('подпись')
  expect(chatLineText('', undefined)).toBe('')
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
  expect(chatKeyAction('Enter', { ...ctx, chatOpen: true })).toBe('focus')
  expect(chatKeyAction('Escape', ctx)).toBeNull()
})

test('чат открыт, фокус ушёл кликом мимо поля: Enter возвращает фокус', () => {
  expect(chatKeyAction('Enter', { chatOpen: true, typing: false, blocked: false })).toBe('focus')
  expect(chatKeyAction('Enter', { chatOpen: true, typing: true, blocked: false })).toBeNull()
})
