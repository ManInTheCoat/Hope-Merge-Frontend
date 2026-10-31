export type PhotoCardState = { kind: 'uploading' } | { kind: 'saved' } | { kind: 'error'; text: string }

export type PhotoCard = {
  show(url: string, state: PhotoCardState): void
  hide(): void
}

/** Сколько карточка «Сохранено» остаётся на экране. */
const SAVED_VISIBLE_MS = 6000
/** Длительность угасания, совпадает с transition в `.photo-card--fading`. */
const FADE_MS = 400

/** Карточка последнего снимка справа внизу: миниатюра, статус загрузки и кнопки. */
export function createPhotoCard(host: HTMLElement, h: { onRetry(): void; onDownload(): void }): PhotoCard {
  const card = document.createElement('div')
  card.className = 'photo-card'
  card.hidden = true
  const img = document.createElement('img')
  img.className = 'photo-card-image'
  img.alt = 'Последний снимок'
  const status = document.createElement('div')
  status.className = 'photo-card-status'
  const actions = document.createElement('div')
  actions.className = 'photo-card-actions'
  const retry = document.createElement('button')
  retry.className = 'photo-card-button'
  retry.textContent = 'Повторить'
  const download = document.createElement('button')
  download.className = 'photo-card-button'
  download.textContent = '⬇ Скачать (G)'
  actions.append(retry, download)
  card.append(img, status, actions)
  host.appendChild(card)

  // Клик по кнопке не должен уходить в canvas и захватывать мышь.
  retry.addEventListener('click', (e) => {
    e.stopPropagation()
    h.onRetry()
  })
  download.addEventListener('click', (e) => {
    e.stopPropagation()
    h.onDownload()
  })

  let timers: ReturnType<typeof setTimeout>[] = []
  const clearTimers = () => {
    timers.forEach(clearTimeout)
    timers = []
  }

  return {
    show(url, state) {
      clearTimers()
      card.hidden = false
      card.classList.remove('photo-card--fading')
      if (img.src !== url) img.src = url
      card.classList.toggle('photo-card--error', state.kind === 'error')
      status.textContent =
        state.kind === 'uploading' ? 'Загружается…' : state.kind === 'saved' ? 'Сохранено в альбом' : `Не удалось сохранить: ${state.text}`
      actions.hidden = state.kind === 'uploading'
      retry.hidden = state.kind !== 'error'
      if (state.kind === 'saved') {
        timers.push(
          setTimeout(() => {
            card.classList.add('photo-card--fading')
            timers.push(setTimeout(() => (card.hidden = true), FADE_MS))
          }, SAVED_VISIBLE_MS),
        )
      }
    },
    hide() {
      clearTimers()
      card.hidden = true
      card.classList.remove('photo-card--fading')
      img.removeAttribute('src')
    },
  }
}
