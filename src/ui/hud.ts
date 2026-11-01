import { formatCache, formatMemory } from './cacheFormat'
import type { LinkView } from './linkView'
import { el } from './dom'

export type ExhibitCard = { title: string; description: string; image: ImageBitmap | null }

export type LoadingState = null | { kind: 'loading'; text: string } | { kind: 'error'; message: string; onRetry: () => void }

export type Hud = {
  showHint(text: string | null): void
  /** Реплика посетителя, просящего пройти: одна строка внизу экрана; null скрывает её. */
  showRequest(text: string | null): void
  showCard(card: ExhibitCard | null): void
  showMessage(text: string, ms?: number): void
  showClickOverlay(visible: boolean, onClick?: () => void): void
  showLoading(state: LoadingState): void
  /** Кнопка «Выйти»; null скрывает её. */
  showLogout(onClick: (() => void) | null): void
  /** Кнопка «Админ» (только для администратора); null скрывает её. */
  showAdmin(onClick: (() => void) | null): void
  /** Строка кеша и строка памяти; null скрывает обе. */
  showCache(state: { used: number; total: number; limit: number } | null): void
  /** Вызывается каждый кадр: DOM меняется только при изменении чисел. */
  showMemory(textures: number, geometries: number): void
  /** Затемнение на время перехода; промис — когда анимация закончилась. */
  fade(on: boolean): Promise<void>
  fadeText(text: string | null): void
  /** Вспышка фотоаппарата. */
  flash(): void
  /** Состояние соединения: баннер поверх зала или экран без автоповторов. */
  showLink(view: LinkView, actions: LinkActions): void
}

export type LinkActions = { retryNow(): void; enterWorld(): void; reload(): void }

const FADE_MS = 200
const FADE_FALLBACK_MS = 250

export function createHud(root: HTMLElement): Hud {
  el('div', 'hud-crosshair', root)
  const hint = el('div', 'hud-hint', root)
  hint.hidden = true
  const request = el('div', 'hud-request', root)
  request.hidden = true
  const message = el('div', 'hud-message', root)
  message.hidden = true

  const card = el('div', 'hud-card', root)
  card.hidden = true
  const cardImage = el('canvas', 'hud-card-image', card)
  const cardTitle = el('h2', 'hud-card-title', card)
  const cardText = el('p', 'hud-card-text', card)
  el('div', 'hud-card-close', card).textContent = 'E — закрыть'

  // Затемнение выше сцены, подсказок и карточки, но ниже экрана загрузки и чата (их DOM-узлы идут позже).
  const fadeLayer = el('div', 'hud-fade', root)
  fadeLayer.style.transitionDuration = `${FADE_MS}ms`
  const fadeLabel = el('div', 'hud-fade-text', fadeLayer)
  fadeLabel.hidden = true
  let fadeOn = false

  const flashLayer = el('div', 'hud-flash', root)

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

  const logoutButton = el('button', 'hud-logout', root)
  logoutButton.hidden = true
  logoutButton.textContent = 'Выйти'
  let logoutHandler: (() => void) | null = null
  logoutButton.addEventListener('click', () => logoutHandler?.())

  const adminButton = el('button', 'hud-admin', root)
  adminButton.hidden = true
  adminButton.textContent = 'Админ'
  let adminHandler: (() => void) | null = null
  adminButton.addEventListener('click', () => adminHandler?.())

  // Баннер переподключения сверху: зал остаётся виден.
  const banner = el('div', 'hud-link-banner', root)
  banner.hidden = true
  const bannerText = el('span', 'hud-link-banner-text', banner)
  const bannerRetry = el('button', 'hud-link-banner-retry', banner)
  bannerRetry.textContent = 'Повторить сейчас'
  // Экран без автоповторов (другая вкладка, старый клиент, закрытое соединение).
  const linkScreen = el('div', 'hud-loading', root)
  linkScreen.hidden = true
  const linkScreenText = el('div', 'hud-loading-text', linkScreen)
  const linkScreenButton = el('button', 'hud-loading-retry', linkScreen)
  let linkActions: LinkActions | null = null
  let linkButton: 'enter' | 'reload' | null = null
  bannerRetry.addEventListener('click', () => linkActions?.retryNow())
  linkScreenButton.addEventListener('click', () => (linkButton === 'reload' ? linkActions?.reload() : linkActions?.enterWorld()))

  // Строка кеша поверх экрана загрузки: видно, как бюджет растёт при загрузке зала.
  const cache = el('div', 'hud-cache', root)
  cache.hidden = true
  const cacheLine = el('div', 'hud-cache-line', cache)
  const memoryLine = el('div', 'hud-cache-line', cache)
  let memoryKey = ''

  let messageTimer: ReturnType<typeof setTimeout> | undefined
  let hintText: string | null = null
  let requestText: string | null = null

  return {
    showHint(text) {
      if (text === hintText) return // вызывается каждый кадр: не трогаем DOM без изменений
      hintText = text
      hint.hidden = text === null
      if (text !== null) hint.textContent = text
    },
    showRequest(text) {
      if (text === requestText) return // вызывается каждый кадр
      requestText = text
      request.hidden = text === null
      if (text !== null) request.textContent = text
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
    showLogout(onClick) {
      logoutHandler = onClick
      logoutButton.hidden = onClick === null
    },
    showAdmin(onClick) {
      adminHandler = onClick
      adminButton.hidden = onClick === null
    },
    showCache(state) {
      cache.hidden = state === null
      if (!state) {
        memoryKey = ''
        return
      }
      cacheLine.textContent = formatCache(state.used, state.total, state.limit)
      cache.classList.toggle('hud-cache--over', state.used > state.limit)
    },
    showMemory(textures, geometries) {
      const key = `${textures}:${geometries}`
      if (key === memoryKey) return
      memoryKey = key
      memoryLine.textContent = formatMemory(textures, geometries)
    },
    fade(on) {
      if (on === fadeOn) return Promise.resolve()
      fadeOn = on
      fadeLayer.classList.toggle('hud-fade--on', on)
      return new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer)
          fadeLayer.removeEventListener('transitionend', done)
          resolve()
        }
        const timer = setTimeout(done, FADE_FALLBACK_MS)
        fadeLayer.addEventListener('transitionend', done)
      })
    },
    flash() {
      flashLayer.classList.remove('hud-flash--on')
      void flashLayer.offsetWidth // перезапуск анимации при частых снимках
      flashLayer.classList.add('hud-flash--on')
    },
    showLink(view, actions) {
      linkActions = actions
      banner.hidden = view.banner === null
      if (view.banner) {
        bannerText.textContent = view.banner.text
        bannerRetry.hidden = !view.banner.retry
      }
      linkScreen.hidden = view.screen === null
      linkButton = view.screen?.button ?? null
      if (view.screen) {
        linkScreenText.textContent = view.screen.text
        linkScreenButton.textContent = view.screen.button === 'reload' ? 'Обновить' : 'Войти в мир'
      }
    },
    fadeText(text) {
      fadeLabel.hidden = text === null
      if (text !== null) fadeLabel.textContent = text
    },
  }
}
