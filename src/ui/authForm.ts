import { ApiError } from '../network/api'

export type FieldName = 'username' | 'display_name' | 'password'
export type FieldErrors = Partial<Record<FieldName, string>>

const USERNAME_RE = /^[A-Za-z0-9_]{3,32}$/
const FIELD_NAMES: FieldName[] = ['username', 'display_name', 'password']

/** Обрезка по Unicode White_Space, как на сервере (api.md §1). */
export const trimWs = (s: string) => s.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '')
export const codePoints = (s: string) => [...s].length

function checkUsername(username: string, errors: FieldErrors) {
  if (!USERNAME_RE.test(trimWs(username))) errors.username = '3–32 символа: латиница, цифры, _'
}

export function validateLogin(f: { username: string; password: string }): FieldErrors {
  const errors: FieldErrors = {}
  checkUsername(f.username, errors)
  if (!f.password) errors.password = 'Введите пароль'
  return errors
}

export function validateRegister(f: { username: string; display_name: string; password: string }): FieldErrors {
  const errors: FieldErrors = {}
  checkUsername(f.username, errors)
  const nameLen = codePoints(trimWs(f.display_name))
  if (nameLen < 1 || nameLen > 32) errors.display_name = 'От 1 до 32 символов'
  const bytes = new TextEncoder().encode(f.password).length
  if (bytes < 8 || bytes > 128) errors.password = 'От 8 до 128 байт'
  return errors
}

export function authErrorText(e: unknown): { form: string; fields: FieldErrors } {
  if (!(e instanceof ApiError)) return { form: 'Не удалось войти, попробуйте ещё раз', fields: {} }
  switch (e.code) {
    case 'USERNAME_TAKEN':
      return { form: 'Имя занято', fields: {} }
    case 'INVALID_CREDENTIALS':
      return { form: 'Неверное имя или пароль', fields: {} }
    case 'RATE_LIMITED':
      return { form: `Слишком много попыток, подождите ${Math.ceil((e.retryAfterMs ?? 1000) / 1000)} с`, fields: {} }
    case 'VALIDATION_ERROR': {
      const fields: FieldErrors = {}
      for (const name of FIELD_NAMES) if (e.fields?.[name]) fields[name] = e.fields[name]
      return { form: Object.keys(fields).length ? '' : 'Проверьте введённые данные', fields }
    }
    default:
      return { form: 'Не удалось войти, попробуйте ещё раз', fields: {} }
  }
}
