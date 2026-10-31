export type ExhibitCard = { title: string; description: string; image: ImageBitmap | null }

export type LoadingState = null | { kind: 'loading'; text: string } | { kind: 'error'; message: string; onRetry: () => void }

export type Hud = {
  showHint(text: string | null): void
  showCard(card: ExhibitCard | null): void
  showMessage(text: string, ms?: number): void
  showClickOverlay(visible: boolean, onClick?: () => void): void
  showLoading(state: LoadingState): void
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = cls
  parent.appendChild(node)
  return node
}

export function createHud(root: HTMLElement): Hud {
  const crosshair = el('div', 'hud-crosshair', root)
  crosshair.hidden = false
  const hint = el('div', 'hud-hint', root)
  hint.hidden = true
  const message = el('div', 'hud-message', root)
  message.hidden = true

  const card = el('div', 'hud-card', root)
  card.hidden = true
  const cardImage = el('canvas', 'hud-card-image', card)
  const cardTitle = el('h2', 'hud-card-title', card)
  const cardText = el('p', 'hud-card-text', card)
  el('div', 'hud-card-close', card).textContent = 'E — закрыть'

  const overlay = el('div', 'hud-overlay', root)
  overlay.hidden = true
  overlay.textContent = 'Кликните, чтобы продолжить'
  let overlayClick: (() => void) | undefined
  overlay.addEventListener('click', () => overlayClick?.())

  const loading = el('div', 'hud-loading', root)
  loading.hidden = true
  const loadingText = el('div', 'hud-loading-text', loading)
  const retry = el('button', 'hud-loading-retry', loading)
  retry.textContent = 'Повторить'
  let retryHandler: (() => void) | undefined
  retry.addEventListener('click', () => retryHandler?.())

  let messageTimer: ReturnType<typeof setTimeout> | undefined
  let hintText: string | null = null

  return {
    showHint(text) {
      if (text === hintText) return // вызывается каждый кадр: не трогаем DOM без изменений
      hintText = text
      hint.hidden = text === null
      if (text !== null) hint.textContent = text
    },
    showCard(c) {
      card.hidden = c === null
      if (!c) return
      cardTitle.textContent = c.title
      cardText.textContent = c.description
      cardImage.hidden = !c.image
      if (c.image) {
        cardImage.width = 320
        cardImage.height = Math.round((320 * c.image.height) / c.image.width)
        // Битмап декодирован с flipY для WebGL, поэтому на 2D-canvas рисуем его обратно перевёрнутым.
        const ctx = cardImage.getContext('2d')!
        ctx.save()
        ctx.translate(0, cardImage.height)
        ctx.scale(1, -1)
        ctx.drawImage(c.image, 0, 0, cardImage.width, cardImage.height)
        ctx.restore()
      }
    },
    showMessage(text, ms = 3000) {
      message.textContent = text
      message.hidden = false
      clearTimeout(messageTimer)
      messageTimer = setTimeout(() => (message.hidden = true), ms)
    },
    showClickOverlay(visible, onClick) {
      overlay.hidden = !visible
      overlayClick = onClick
    },
    showLoading(state) {
      loading.hidden = state === null
      if (!state) return
      retry.hidden = state.kind !== 'error'
      loadingText.textContent = state.kind === 'loading' ? state.text : state.message
      retryHandler = state.kind === 'error' ? state.onRetry : undefined
    },
  }
}
