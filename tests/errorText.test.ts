import { expect, test } from 'bun:test'
import { ApiError } from '../src/network/api'
import { rateLimitText, userErrorText } from '../src/ui/errorText'

const TECHNICAL = /[A-Z_]{4,}|\d{4}/

test('технические ошибки соединения не показываются игроку кодами', () => {
  for (const msg of ['SOCKET_CLOSED:1006', 'SOCKET_CLOSED', 'SNAPSHOT_TIMEOUT', 'REQUEST_TIMEOUT', 'UNSUPPORTED_PROTOCOL']) {
    const text = userErrorText(new Error(msg))
    expect(text).not.toMatch(TECHNICAL)
    expect(text.length).toBeGreaterThan(0)
  }
  expect(userErrorText(new Error('SOCKET_CLOSED:1006'))).toBe('Нет связи с сервером')
  expect(userErrorText(new Error('REQUEST_TIMEOUT'))).toBe('Сервер не ответил, попробуйте ещё раз')
})

test('RATE_LIMITED из WS и из HTTP', () => {
  expect(userErrorText({ code: 'RATE_LIMITED', message: 'x', retry_after_ms: 2500 })).toBe('Слишком часто, подождите 3 с')
  expect(userErrorText(new ApiError(429, 'RATE_LIMITED', 'x', { retry_after_ms: 1000 }))).toBe('Слишком часто, подождите 1 с')
  expect(rateLimitText(undefined)).toBe('Слишком часто, подождите 1 с')
})

test('сообщение сервера показывается как есть', () => {
  expect(userErrorText({ code: 'OUT_OF_RANGE', message: 'Текст' })).toBe('Текст')
  expect(userErrorText(new ApiError(503, 'SERVICE_UNAVAILABLE', 'x'))).toBe('x')
  expect(userErrorText(new Error('Версия мира не совпадает, обновите страницу'))).toBe('Версия мира не совпадает, обновите страницу')
})

test('сетевой сбой fetch и неизвестное', () => {
  expect(userErrorText(new TypeError('Failed to fetch'))).toBe('Нет связи с сервером')
  expect(userErrorText(null)).toBe('Что-то пошло не так')
})
