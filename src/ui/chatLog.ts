import { validateText } from './text'

export const CHAT_MAX_LEN = 500
const CHAT_KEEP = 100

/** Текст после trim в кодовых точках 1–500, иначе null (api.md §6). */
export const validateChatText = (raw: string): string | null => validateText(raw, CHAT_MAX_LEN)

export type ChatLine = { author: string; color: string | null; text: string }

/** Фото в чате этот этап не показывает: сообщение только с фото выводим заглушкой. */
export function chatLineText(text: string, hasPhoto: boolean): string {
  return !text && hasPhoto ? '[фото]' : text
}

/** История на сервере не хранится: держим в памяти последние CHAT_KEEP сообщений. */
export class ChatLog {
  private list: ChatLine[] = []

  get lines(): readonly ChatLine[] {
    return this.list
  }

  push(line: ChatLine): void {
    this.list.push(line)
    if (this.list.length > CHAT_KEEP) this.list.splice(0, this.list.length - CHAT_KEEP)
  }

  clear(): void {
    this.list = []
  }
}

export type ChatKeyContext = {
  chatOpen: boolean
  /** Фокус в поле ввода: его клавиши обрабатывает само поле. */
  typing: boolean
  /** Чат сейчас открывать нельзя: экран входа, карточка экспоната, нет связи. */
  blocked: boolean
}

/** Что делает клавиша на уровне документа: открыть чат, закрыть его или ничего. */
export function chatKeyAction(code: string, ctx: ChatKeyContext): 'open' | 'close' | null {
  // Esc ловим и вне поля: фокус мог уйти кликом мимо, а чат при этом остаётся открытым.
  if (code === 'Escape') return ctx.chatOpen ? 'close' : null
  if (code !== 'Enter' && code !== 'NumpadEnter') return null
  return ctx.chatOpen || ctx.typing || ctx.blocked ? null : 'open'
}
