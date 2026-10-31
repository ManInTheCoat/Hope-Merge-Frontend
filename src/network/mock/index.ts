import { createMockServer } from './server'
import { buildWorld } from './world'

/** Подменяет fetch и WebSocket для адресов `/api/v1`, остальное идёт как обычно. */
export async function installMocks(): Promise<void> {
  const server = createMockServer(await buildWorld())
  window.fetch = server.fetch
  window.WebSocket = server.WebSocket
}
