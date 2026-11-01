import { inputMeta, trimWs } from './text'
import { CHAT_MAX_LEN, ChatLog, validateChatText, type ChatLine } from './chatLog'

const FADE_AFTER_MS = 10_000
const COUNTER_FROM = 450
const NEUTRAL_COLOR = '#c9c4bb'

export type Chat = {
  add(line: ChatLine): void
  open(): void
  /** Вернуть фокус в поле открытого чата. */
  focus(): void
  close(): void
  readonly isOpen: boolean
  clear(): void
}

export type ChatOptions = {
  /** Отправка; промис отклоняется с текстом ошибки для показа под полем. */
  onSend: (text: string) => Promise<void>
  /** Поле закрыто: `sent` — после успешной отправки, иначе по Esc. */
  onClose: (sent: boolean) => void
}

/** Общий чат, вариант A: лента всегда видна внизу слева, поле ввода по Enter. */
export function createChat(root: HTMLElement, opts: ChatOptions): Chat {
  const box = document.createElement('div')
  box.className = 'chat'
  root.appendChild(box)
  const logEl = document.createElement('div')
  logEl.className = 'chat-log'
  box.appendChild(logEl)

  const form = document.createElement('form')
  form.className = 'chat-form'
  form.hidden = true
  box.appendChild(form)
  const input = document.createElement('input')
  input.className = 'chat-input'
  input.maxLength = CHAT_MAX_LEN * 2 // maxlength считает UTF-16; точный предел — в validateChatText
  input.placeholder = 'Сообщение…'
  input.autocomplete = 'off'
  form.appendChild(input)
  const button = document.createElement('button')
  button.type = 'submit'
  button.className = 'chat-send'
  button.textContent = 'Отправить'
  form.appendChild(button)
  const meta = document.createElement('div')
  meta.className = 'chat-meta'
  box.appendChild(meta)
  meta.hidden = true
  const hint = document.createElement('div')
  hint.className = 'chat-hint'
  hint.textContent = 'Enter — написать в чат'
  box.appendChild(hint)

  const log = new ChatLog()
  let isOpen = false
  let sending = false
  /** Номер текущего открытия поля: поздний ответ на отправку из прошлого открытия не трогает новое. */
  let openId = 0
  let fadeTimer: ReturnType<typeof setTimeout> | undefined

  function wake() {
    box.classList.remove('chat--faded')
    clearTimeout(fadeTimer)
    fadeTimer = setTimeout(() => box.classList.add('chat--faded'), FADE_AFTER_MS)
  }

  function render() {
    logEl.replaceChildren(
      ...log.lines.map((l) => {
        const row = document.createElement('div')
        row.className = 'chat-line'
        const name = document.createElement('b')
        name.textContent = `${l.author}: `
        name.style.color = l.color ?? NEUTRAL_COLOR
        row.append(name, document.createTextNode(l.text))
        return row
      }),
    )
    logEl.scrollTop = logEl.scrollHeight
  }

  function updateMeta(error?: string) {
    meta.textContent = inputMeta(input.value, CHAT_MAX_LEN, COUNTER_FROM, error)
    meta.classList.toggle('chat-meta--error', !!error)
    meta.hidden = !isOpen || !meta.textContent
  }

  function close() {
    if (!isOpen) return
    isOpen = false
    openId++
    box.classList.remove('chat--open')
    form.hidden = true
    hint.hidden = false
    input.blur()
    updateMeta()
    logEl.scrollTop = logEl.scrollHeight
    wake()
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (sending) return
    const raw = input.value
    const text = validateChatText(raw)
    if (text === null) return updateMeta(trimWs(raw) ? `Не больше ${CHAT_MAX_LEN} символов` : undefined)
    const id = openId
    sending = true
    button.disabled = true
    try {
      await opts.onSend(text)
      if (input.value === raw) input.value = ''
      // Поле успели закрыть (Esc) или открыть заново: игру и новое поле не трогаем.
      if (id !== openId) return
      close()
      opts.onClose(true)
    } catch (err) {
      if (id === openId) updateMeta(err instanceof Error ? err.message : String(err))
    } finally {
      sending = false
      button.disabled = false
    }
  })
  input.addEventListener('input', () => updateMeta())
  input.addEventListener('keydown', (e) => {
    // Клавиши поля не должны доходить до игры: Enter не переоткрывает чат, Esc не трогает другие окна.
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      opts.onClose(false)
    }
  })

  wake()

  return {
    add(line) {
      log.push(line)
      render()
      wake()
    },
    focus() {
      if (isOpen) input.focus()
    },
    open() {
      if (isOpen) return
      isOpen = true
      openId++
      hint.hidden = true
      box.classList.add('chat--open')
      box.classList.remove('chat--faded')
      clearTimeout(fadeTimer)
      form.hidden = false
      updateMeta()
      input.focus()
    },
    close,
    get isOpen() {
      return isOpen
    },
    clear() {
      log.clear()
      render()
    },
  }
}
