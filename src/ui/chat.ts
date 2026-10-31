import { CHAT_MAX_LEN, ChatLog, validateChatText, type ChatLine } from './chatLog'

const FADE_AFTER_MS = 10_000
const COUNTER_FROM = 450
const NEUTRAL_COLOR = '#c9c4bb'

export type Chat = {
  add(line: ChatLine): void
  open(): void
  close(): void
  readonly isOpen: boolean
  showError(text: string): void
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

  const log = new ChatLog()
  let isOpen = false
  let sending = false
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
    const len = [...input.value].length
    const counter = len > COUNTER_FROM ? `${len} / ${CHAT_MAX_LEN}` : ''
    meta.textContent = [error, counter].filter(Boolean).join(' · ')
    meta.classList.toggle('chat-meta--error', !!error)
    meta.hidden = !isOpen || !meta.textContent
  }

  function close() {
    if (!isOpen) return
    isOpen = false
    box.classList.remove('chat--open')
    form.hidden = true
    input.blur()
    updateMeta()
    logEl.scrollTop = logEl.scrollHeight
    wake()
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (sending) return
    const text = validateChatText(input.value)
    if (text === null) return updateMeta(input.value.trim() ? `Не больше ${CHAT_MAX_LEN} символов` : undefined)
    sending = true
    button.disabled = true
    try {
      await opts.onSend(text)
      input.value = ''
      close()
      opts.onClose(true)
    } catch (err) {
      updateMeta(err instanceof Error ? err.message : String(err))
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
    open() {
      if (isOpen) return
      isOpen = true
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
    showError(text) {
      updateMeta(text)
    },
    clear() {
      log.clear()
      render()
    },
  }
}
