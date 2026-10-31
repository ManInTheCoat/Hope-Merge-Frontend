import { codePoints, trimWs } from './authForm'

export const CHAT_MAX_LEN = 500
export const CHAT_KEEP = 100

/** Текст после trim в кодовых точках 1–500, иначе null (api.md §6). */
export function validateChatText(raw: string): string | null {
  const text = trimWs(raw)
  const len = codePoints(text)
  return len >= 1 && len <= CHAT_MAX_LEN ? text : null
}

export type ChatLine = { id: string; author: string; color: string | null; text: string }

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
