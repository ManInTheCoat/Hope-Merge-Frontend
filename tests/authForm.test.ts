import { expect, test } from 'bun:test'
import { ApiError } from '../src/network/api'
import { authErrorText, validateLogin, validateRegister } from '../src/ui/authForm'

test('логин проверяется по шаблону api.md', () => {
  expect(validateRegister({ username: 'ab', display_name: 'A', password: '12345678' }).username).toBeDefined()
  expect(validateRegister({ username: 'anna-1', display_name: 'A', password: '12345678' }).username).toBeDefined()
  expect(validateRegister({ username: 'Anna_1', display_name: 'A', password: '12345678' })).toEqual({})
})

test('имя обрезается и считается в кодовых точках', () => {
  expect(validateRegister({ username: 'anna', display_name: '   ', password: '12345678' }).display_name).toBeDefined()
  expect(validateRegister({ username: 'anna', display_name: '😀'.repeat(32), password: '12345678' })).toEqual({})
  expect(validateRegister({ username: 'anna', display_name: '😀'.repeat(33), password: '12345678' }).display_name).toBeDefined()
})

test('пароль: байты UTF-8, без trim', () => {
  expect(validateRegister({ username: 'anna', display_name: 'A', password: ' 1234567' })).toEqual({})
  expect(validateRegister({ username: 'anna', display_name: 'A', password: '1234567' }).password).toBeDefined()
  expect(validateRegister({ username: 'anna', display_name: 'A', password: 'я'.repeat(65) }).password).toBeDefined() // 130 байт
  expect(validateRegister({ username: 'anna', display_name: 'A', password: 'я'.repeat(64) })).toEqual({}) // 128 байт
})

test('при входе нужен только непустой пароль', () => {
  expect(validateLogin({ username: 'anna', password: '' }).password).toBe('Введите пароль')
  expect(validateLogin({ username: 'anna', password: 'x' })).toEqual({})
})

test('коды сервера переводятся на русский', () => {
  expect(authErrorText(new ApiError(409, 'USERNAME_TAKEN', 'x')).form).toBe('Имя занято')
  expect(authErrorText(new ApiError(401, 'INVALID_CREDENTIALS', 'x')).form).toBe('Неверное имя или пароль')
  expect(authErrorText(new TypeError('Failed to fetch')).form).toBe('Не удалось войти, попробуйте ещё раз')
})

test('RATE_LIMITED показывает секунды ожидания', () => {
  const e = new ApiError(429, 'RATE_LIMITED', 'x', { retry_after_ms: 4200 })
  expect(authErrorText(e).form).toBe('Слишком много попыток, подождите 5 с')
})

test('VALIDATION_ERROR раскладывает fields по полям', () => {
  const e = new ApiError(400, 'VALIDATION_ERROR', 'x', { fields: { username: 'bad' } })
  expect(authErrorText(e).fields.username).toBe('bad')
})
