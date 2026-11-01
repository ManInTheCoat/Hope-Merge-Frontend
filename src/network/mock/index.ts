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
  // Ручная проверка переподключения из консоли: __mock.drop(1012), __mock.drop(4009)…
  // __mock.patchRuntime({ config: { accent_color: '#6a8caf', installation_visible: true } }) — оформление зала.
  // __mock.clients() — FPS, ping и видимость этой вкладки так, как их видит админка.
  ;(window as unknown as { __mock: Pick<typeof server, 'drop' | 'patchRuntime' | 'clients'> }).__mock = {
    drop: (code) => server.drop(code),
    patchRuntime: (patch) => server.patchRuntime(patch),
    clients: () => server.clients(),
  }
}
