import './style.css'

async function boot() {
  if (import.meta.env.VITE_USE_MOCK === 'true') {
    const { installMocks } = await import('./network/mock')
    await installMocks()
  }
  const { startGame } = await import('./game')
  await startGame(document.querySelector<HTMLDivElement>('#app')!)
}

void boot()
