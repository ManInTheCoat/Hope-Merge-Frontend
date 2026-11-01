import type { ImageDeps } from '../album/albumImages'
import type { Photo } from '../network/contract'

/** Картинка строки чата: `url` появляется, когда миниатюра загружена, и исчезает, когда её вытеснили. */
export type ChatPhoto = { id: string; alt: string; url: string | null }

/**
 * Не больше трёх миниатюр в чате: вместе с шестью миниатюрами альбома (пока он открыт, чатовые освобождены)
 * это не выходит за «до шести миниатюр» из api.md §3.
 */
export const CHAT_THUMB_MAX = 3

export const chatThumbKey = (id: string): string => `photo:chat:${id}`

type Entry = { id: string; target: ChatPhoto; url: string | null; dead: boolean }

/** Миниатюры фото в общем чате: учёт в бюджете кеша, вытеснение старых, пауза на время альбома. */
export class ChatThumbs {
  private readonly d: ImageDeps & { onChange(): void }
  private entries: Entry[] = []
  private suspended = false

  constructor(deps: ImageDeps & { onChange(): void }) {
    this.d = deps
  }

  show(target: ChatPhoto, photo: Photo): void {
    if (this.suspended) return
    const same = this.entries.find((e) => e.id === photo.id)
    if (same) this.drop(same)
    while (this.entries.length >= CHAT_THUMB_MAX) this.drop(this.entries[0])
    try {
      this.d.budget.reserve(chatThumbKey(photo.id), photo.thumbnail_bytes)
    } catch {
      return // нет места в бюджете: в строке остаётся текст
    }
    const entry: Entry = { id: photo.id, target, url: null, dead: false }
    this.entries.push(entry)
    this.d.fetchBlob(photo.thumbnail_url, photo.thumbnail_bytes).then(
      (blob) => {
        if (entry.dead) return
        this.d.budget.settle(chatThumbKey(entry.id), blob.size)
        entry.url = this.d.makeUrl(blob)
        entry.target.url = entry.url
        this.d.onChange()
      },
      () => {
        if (!entry.dead) this.drop(entry)
      },
    )
  }

  /** Открыт альбом: его миниатюры важнее, чатовые освобождаются, новые не грузятся. */
  suspend(): void {
    this.suspended = true
    this.releaseAll()
  }

  resume(): void {
    this.suspended = false
  }

  releaseAll(): void {
    for (const e of [...this.entries]) this.drop(e)
  }

  private drop(e: Entry) {
    e.dead = true
    this.entries = this.entries.filter((x) => x !== e)
    const shown = e.url !== null
    if (e.url) this.d.revokeUrl(e.url)
    e.url = null
    e.target.url = null
    this.d.budget.release(chatThumbKey(e.id))
    if (shown) this.d.onChange()
  }
}
