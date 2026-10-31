import type { Generation, GenerationsPage, Guide } from '../network/contract'
import { codePoints, trimWs } from './authForm'
import { GUIDE_MAX_LEN, validateGuideText, type GuideAsks } from './guideAsks'
import { panelKeyAction } from './guideKeys'

const COUNTER_FROM = 1800
/** Ближе этого к краю ленты считаем, что игрок у края: подгружаем историю или прокручиваем к новому. */
const EDGE_PX = 40

export type GuidePanelOptions = {
  asks: GuideAsks
  loadPage(guideId: string, before: string | null): Promise<GenerationsPage>
  /** Отправить вопрос; вернуть текст ошибки или null, если ушёл. */
  onAsk(guide: Guide, text: string): string | null
  /** Отменить активный вопрос; промис отклоняется с текстом ошибки. */
  onCancel(): Promise<void>
  /** Панель закрыта игроком (E или ✕): вернуть управление и захват мыши. */
  onClose(): void
}

export type GuidePanel = {
  open(guide: Guide): void
  /** Закрыть без `onClose`: вызывающий сам решает, что делать с управлением. */
  close(): void
  readonly isOpen: boolean
  /** Гид открытой панели или null. */
  readonly guideId: string | null
  /** Ошибка под полем; `restore` — вернуть текст вопроса в поле. */
  showError(text: string, restore?: string): void
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  parent.appendChild(node)
  return node
}

/** Диалог с гидом, вариант A: панель справа, зал остаётся виден. */
export function createGuidePanel(root: HTMLElement, opts: GuidePanelOptions): GuidePanel {
  const { asks } = opts
  const box = el('div', 'guide-panel', root)
  box.hidden = true
  // Пока поле заблокировано, фокус держит сама панель: иначе клавиши уйдут в игру и общий чат.
  box.tabIndex = -1

  const head = el('div', 'guide-head', box)
  const titles = el('div', 'guide-titles', head)
  const nameEl = el('div', 'guide-name', titles)
  const subtitleEl = el('div', 'guide-subtitle', titles)
  const closeBox = el('div', 'guide-close', head)
  el('span', 'guide-close-hint', closeBox).textContent = 'E — закрыть'
  const closeBtn = el('button', 'guide-close-btn', closeBox)
  closeBtn.type = 'button'
  closeBtn.textContent = '✕'
  closeBtn.title = 'Закрыть'
  closeBtn.setAttribute('aria-label', 'Закрыть')

  const logEl = el('div', 'guide-log', box)
  const statusEl = el('div', 'guide-status', box)
  const statusText = el('span', 'guide-status-text', statusEl)
  const cancelBtn = el('button', 'guide-cancel', statusEl)
  cancelBtn.type = 'button'
  cancelBtn.textContent = 'Отменить'

  const form = el('form', 'guide-form', box)
  const input = el('input', 'guide-input', form)
  input.maxLength = GUIDE_MAX_LEN * 2 // maxlength считает UTF-16; точный предел — в validateGuideText
  input.placeholder = 'Спросите гида…'
  input.autocomplete = 'off'
  const sendBtn = el('button', 'guide-send', form)
  sendBtn.type = 'submit'
  sendBtn.textContent = 'Спросить'
  const meta = el('div', 'guide-meta', box)

  let guide: Guide | null = null
  let history: Generation[] = []
  let nextBefore: string | null = null
  let historyState: 'loading' | 'error' | 'ready' = 'loading'
  let loadingOlder = false
  /** Номер открытия: ответ на загрузку из прошлого открытия (или другого гида) не трогает текущее. */
  let openId = 0
  let error = ''

  function updateMeta() {
    const len = codePoints(trimWs(input.value))
    const counter = len > COUNTER_FROM ? `${len} / ${GUIDE_MAX_LEN}` : ''
    meta.textContent = [error, counter].filter(Boolean).join(' · ')
    meta.classList.toggle('guide-meta--error', !!error)
    meta.hidden = !meta.textContent
  }

  function setError(text: string) {
    error = text
    updateMeta()
  }

  function notice(text: string, retry?: () => void) {
    const row = document.createElement('div')
    row.className = 'guide-notice'
    row.textContent = text
    if (retry) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'guide-retry'
      btn.textContent = 'Повторить'
      btn.addEventListener('click', retry)
      row.append(' ', btn)
    }
    return row
  }

  function render() {
    if (!guide) return
    const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < EDGE_PX
    const rows: HTMLElement[] = []
    if (historyState === 'loading') rows.push(notice('Загрузка…'))
    if (historyState === 'error') rows.push(notice('Не удалось загрузить историю', () => void loadFirst()))
    if (loadingOlder) rows.push(notice('Загрузка…'))
    for (const e of asks.entries(guide.id, history)) {
      const q = document.createElement('div')
      q.className = 'guide-q'
      q.textContent = e.question
      rows.push(q)
      if (e.answer || e.state === 'done') {
        const a = document.createElement('div')
        a.className = 'guide-a'
        a.textContent = e.answer
        rows.push(a)
      }
      if (e.note) {
        const n = document.createElement('div')
        n.className = 'guide-note'
        n.textContent = e.note
        rows.push(n)
      }
    }
    logEl.replaceChildren(...rows)
    if (atBottom) logEl.scrollTop = logEl.scrollHeight

    const status = asks.status(guide.id)
    statusEl.hidden = !status
    statusText.textContent = status?.text ?? ''
    cancelBtn.disabled = !status?.canCancel
    const busy = asks.active !== null
    const wasBusy = input.disabled
    input.disabled = busy
    sendBtn.disabled = busy
    // Фокус двигаем только при смене блокировки, а не на каждом delta: клик игрока по ленте не сбиваем.
    if (busy && !box.contains(document.activeElement)) box.focus()
    else if (busy && document.activeElement === input) box.focus()
    else if (!busy && wasBusy && (document.activeElement === box || document.activeElement === document.body)) input.focus()
  }

  async function loadFirst() {
    if (!guide) return
    const id = openId
    historyState = 'loading'
    render()
    try {
      const page = await opts.loadPage(guide.id, null)
      if (id !== openId) return
      history = page.items
      nextBefore = page.next_before
      historyState = 'ready'
    } catch {
      if (id !== openId) return
      historyState = 'error'
    }
    render()
    logEl.scrollTop = logEl.scrollHeight
  }

  async function loadOlder() {
    if (!guide || historyState !== 'ready' || loadingOlder || nextBefore === null) return
    const id = openId
    loadingOlder = true
    render()
    try {
      const page = await opts.loadPage(guide.id, nextBefore)
      if (id !== openId) return
      const known = new Set(history.map((g) => g.id))
      history = [...page.items.filter((g) => !known.has(g.id)), ...history]
      nextBefore = page.next_before
    } catch {
      if (id !== openId) return
      // Повторим при следующей прокрутке к верху.
    } finally {
      if (id === openId) loadingOlder = false
    }
    const fromBottom = logEl.scrollHeight - logEl.scrollTop
    render()
    logEl.scrollTop = logEl.scrollHeight - fromBottom
  }

  function close() {
    if (!guide) return
    guide = null
    openId++
    box.hidden = true
    input.blur()
  }

  asks.onChange(render)

  logEl.addEventListener('scroll', () => {
    if (logEl.scrollTop < EDGE_PX) void loadOlder()
  })

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    if (!guide || asks.active) return
    const raw = input.value
    const text = validateGuideText(raw)
    if (text === null) return setError(trimWs(raw) ? `Не больше ${GUIDE_MAX_LEN} символов` : '')
    const err = opts.onAsk(guide, text)
    if (err) return setError(err)
    input.value = ''
    setError('')
    logEl.scrollTop = logEl.scrollHeight
  })
  input.addEventListener('input', () => updateMeta())

  cancelBtn.addEventListener('click', async () => {
    asks.setCancelling(true)
    try {
      await opts.onCancel()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      asks.setCancelling(false)
    }
  })

  box.addEventListener('keydown', (e) => {
    // Клавиши панели не должны доходить до игры и общего чата.
    e.stopPropagation()
    if (e.repeat) return
    if (!panelKeyAction(e.code, { typing: e.target === input, inputDisabled: input.disabled, opening: false })) return
    e.preventDefault()
    close()
    opts.onClose()
  })

  // Клик — действие пользователя: захват мыши вернётся сразу, без затемнения.
  closeBtn.addEventListener('click', () => {
    close()
    opts.onClose()
  })

  return {
    open(g) {
      if (guide) return
      guide = g
      openId++
      history = []
      nextBefore = null
      loadingOlder = false
      error = ''
      nameEl.textContent = g.display_name
      subtitleEl.textContent = g.subtitle
      subtitleEl.hidden = !g.subtitle
      box.hidden = false
      updateMeta()
      void loadFirst()
      if (!input.disabled) input.focus()
    },
    close,
    get isOpen() {
      return guide !== null
    },
    get guideId() {
      return guide?.id ?? null
    },
    showError(text, restore) {
      if (restore !== undefined && !input.value) input.value = restore
      setError(text)
    },
  }
}
