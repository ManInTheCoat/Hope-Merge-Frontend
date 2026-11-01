import type { AlbumState } from '../album/albumController'
import { EMPTY_ALBUM_TEXT, SHARE_CONFIRM_TEXT, photoMeta } from '../album/albumText'
import { el } from './dom'

export type AlbumPanelHandlers = {
  /** Закрыто кнопкой ✕: вернуть управление. */
  onClose(): void
  onRetry(): void
  onPrev(): void
  onNext(): void
  onView(photoId: string): void
  onBack(): void
  onDownload(): void
  /** Отправить фото в общий чат; отказ — Error с текстом для игрока. */
  onShare(photoId: string): Promise<void>
}

export type AlbumPanel = {
  open(): void
  /** Закрыть без `onClose`: вызывающий сам решает, что делать с управлением. */
  close(): void
  readonly isOpen: boolean
  /** `blockedReason` — почему нельзя отправить в чат сейчас (null — можно). */
  render(state: AlbumState, share: { blockedReason: string | null }): void
}

/** Альбом: сетка миниатюр текущей страницы и крупный просмотр одного фото поверх сцены. */
export function createAlbumPanel(root: HTMLElement, h: AlbumPanelHandlers): AlbumPanel {
  const shade = el('div', 'album', root)
  shade.hidden = true
  const box = el('div', 'album-box', shade)
  box.tabIndex = -1
  const head = el('div', 'album-head', box)
  el('div', 'album-title', head).textContent = 'Альбом'
  const closeBox = el('div', 'album-close', head)
  el('span', 'album-hint', closeBox).textContent = 'B — закрыть'
  const closeBtn = el('button', 'album-button', closeBox)
  closeBtn.type = 'button'
  closeBtn.textContent = '✕'
  const body = el('div', 'album-body', box)

  // Клик по панели не должен уходить в canvas и захватывать мышь.
  shade.addEventListener('click', (e) => e.stopPropagation())
  closeBtn.addEventListener('click', () => h.onClose())

  /** Подтверждение публикации и признак отправки живут между перерисовками одного просмотра. */
  let confirming = false
  let sharing = false
  let shareNotice: string | null = null
  let shownPhotoId: string | null = null

  function button(parent: HTMLElement, text: string, onClick: () => void, disabled = false): HTMLButtonElement {
    const b = el('button', 'album-button', parent)
    b.type = 'button'
    b.textContent = text
    b.disabled = disabled
    b.addEventListener('click', onClick)
    return b
  }

  function renderGrid(s: Extract<AlbumState, { kind: 'grid' }>) {
    if (s.notice) el('div', 'album-notice', body).textContent = s.notice
    if (s.items.length === 0) {
      el('div', 'album-empty', body).textContent = s.busy ? 'Загрузка…' : EMPTY_ALBUM_TEXT
      return
    }
    const grid = el('div', 'album-grid', body)
    for (const p of s.items) {
      const cell = el('button', 'album-cell', grid)
      cell.type = 'button'
      cell.disabled = s.busy
      const url = s.thumbs.get(p.id)
      if (url) {
        const img = el('img', 'album-thumb', cell)
        img.src = url
        img.alt = p.caption || 'Фото'
      } else el('div', 'album-thumb album-thumb--empty', cell).textContent = s.busy ? '…' : '—'
      cell.addEventListener('click', () => h.onView(p.id))
    }
    if (s.hasPrev || s.hasNext) {
      const pager = el('div', 'album-pager', body)
      button(pager, '← Назад', h.onPrev, s.busy || !s.hasPrev)
      button(pager, 'Далее →', h.onNext, s.busy || !s.hasNext)
    }
  }

  function renderViewer(s: Extract<AlbumState, { kind: 'viewer' }>, share: { blockedReason: string | null }) {
    if (shownPhotoId !== s.photo.id) {
      shownPhotoId = s.photo.id
      confirming = false
      sharing = false
      shareNotice = null
    }
    const notice = shareNotice ?? s.notice
    if (notice) el('div', 'album-notice', body).textContent = notice
    if (s.url) {
      const img = el('img', 'album-photo', body)
      img.src = s.url
      img.alt = s.photo.caption || 'Фото'
    } else el('div', 'album-empty', body).textContent = 'Загрузка…'

    const meta = photoMeta(s.photo)
    el('div', 'album-caption', body).textContent = meta.caption
    el('div', 'album-meta', body).textContent = `${meta.room} · ${meta.date}`

    const actions = el('div', 'album-actions', body)
    if (s.single) button(actions, 'Закрыть', h.onClose)
    else button(actions, '← К альбому', h.onBack)
    button(actions, '⬇ Скачать', h.onDownload, !s.url)
    if (s.single) return // фото из чата уже опубликовано, отправлять его снова не нужно
    if (s.photo.published) {
      el('span', 'album-meta', actions).textContent = 'Отправлено в чат'
      return
    }
    if (confirming) {
      el('div', 'album-confirm', body).textContent = SHARE_CONFIRM_TEXT
      const row = el('div', 'album-actions', body)
      button(
        row,
        'Отправить',
        () => {
          if (sharing) return
          sharing = true
          shareNotice = null
          void h.onShare(s.photo.id).then(
            () => {
              sharing = false
              confirming = false
            },
            (e: unknown) => {
              sharing = false
              confirming = false
              shareNotice = e instanceof Error ? e.message : 'Не удалось отправить фото'
              if (last) render(last, lastShare)
            },
          )
          if (last) render(last, lastShare)
        },
        sharing,
      )
      button(
        row,
        'Отмена',
        () => {
          confirming = false
          if (last) render(last, lastShare)
        },
        sharing,
      )
      return
    }
    const send = button(
      actions,
      'Отправить в чат',
      () => {
        confirming = true
        shareNotice = null
        if (last) render(last, lastShare)
      },
      !s.url || share.blockedReason !== null,
    )
    if (share.blockedReason) send.title = share.blockedReason
  }

  let last: AlbumState | null = null
  let lastShare: { blockedReason: string | null } = { blockedReason: null }

  function render(state: AlbumState, share: { blockedReason: string | null }) {
    last = state
    lastShare = share
    body.replaceChildren()
    if (state.kind === 'loading') el('div', 'album-empty', body).textContent = 'Загрузка…'
    else if (state.kind === 'error') {
      el('div', 'album-notice', body).textContent = state.text
      button(body, 'Повторить', h.onRetry)
    } else if (state.kind === 'grid') {
      shownPhotoId = null
      renderGrid(state)
    } else renderViewer(state, share)
  }

  return {
    open() {
      shade.hidden = false
      confirming = false
      sharing = false
      shareNotice = null
      shownPhotoId = null
      box.focus()
    },
    close() {
      shade.hidden = true
      body.replaceChildren()
      last = null
    },
    get isOpen() {
      return !shade.hidden
    },
    render,
  }
}
