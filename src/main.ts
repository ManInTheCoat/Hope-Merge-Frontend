import './style.css'

async function boot() {
  if (import.meta.env.VITE_USE_MOCK === 'true') {
    const { installMocks } = await import('./network/mock')
    await installMocks()
  }
  const { startGame } = await import('./game')
  await startGame(document.querySelector<HTMLDivElement>('#app')!)
}

boot().catch((e: unknown) => {
  // Например, WebGL недоступен: показываем причину вместо пустого экрана.
  console.error(e)
  const app = document.querySelector<HTMLDivElement>('#app')!
  app.textContent = `Не удалось запустить галерею: ${e instanceof Error ? e.message : String(e)}`
  app.style.cssText = 'display:flex;align-items:center;justify-content:center;color:#f4efe6;background:#1a1a1f;font:18px system-ui'
})
