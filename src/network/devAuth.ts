import { ApiError, apiFetch } from './api'

const DEV_USER = { username: 'dev_visitor', display_name: 'Посетитель', password: 'devpassword1' }

const post = (path: string, body: unknown) =>
  apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

/** Только для мок-режима: пока нет экрана входа, заходим тестовым пользователем. */
export async function ensureDevSession(): Promise<void> {
  try {
    await post('/auth/register', DEV_USER)
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 409) throw e
    await post('/auth/login', { username: DEV_USER.username, password: DEV_USER.password })
  }
}
