import { ApiError } from '../network/api'
import type { ErrorBody } from '../network/contract'

export const NO_CONNECTION = 'Нет связи с сервером'
export const NO_RESPONSE = 'Сервер не ответил, попробуйте ещё раз'

/** Секунды ожидания из retry_after_ms с округлением вверх. */
export const retrySeconds = (ms: number | undefined, fallbackMs = 1000) => Math.ceil((ms ?? fallbackMs) / 1000)

export function rateLimitText(retryAfterMs: number | undefined): string {
  return `Слишком часто, подождите ${retrySeconds(retryAfterMs)} с`
}

/** Внутренние ошибки соединения клиента: игроку показываем смысл, а не код. */
function technicalText(message: string): string | null {
  if (message.startsWith('SOCKET_CLOSED')) return NO_CONNECTION
  if (message === 'SNAPSHOT_TIMEOUT' || message === 'REQUEST_TIMEOUT') return NO_RESPONSE
  if (message === 'UNSUPPORTED_PROTOCOL') return 'Версия клиента устарела — обновите страницу'
  return null
}

/** Текст ошибки для игрока: без технических кодов. */
export function userErrorText(e: unknown): string {
  if (e instanceof ApiError) return e.code === 'RATE_LIMITED' ? rateLimitText(e.retryAfterMs) : e.message
  if (e instanceof TypeError) return NO_CONNECTION // fetch без ответа сервера
  if (e instanceof Error) return technicalText(e.message) ?? e.message
  const body = e as Partial<ErrorBody> | null
  if (body?.code === 'RATE_LIMITED') return rateLimitText(body.retry_after_ms)
  return body?.message ?? 'Что-то пошло не так'
}
