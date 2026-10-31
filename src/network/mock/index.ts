import { createMockServer } from './server'
import { buildWorld } from './world'

/** Подменяет fetch и WebSocket для адресов `/api/v1`, остальное идёт как обычно. */
export async function installMocks(): Promise<void> {
  let storage: Storage | null = null
  try {
    storage = window.localStorage
  } catch {
    // доступ к хранилищу запрещён: мок живёт только в памяти
  }
  const server = createMockServer(await buildWorld(), storage)
  window.fetch = server.fetch
  window.WebSocket = server.WebSocket
}
