import type { ImageDeps } from '../album/albumImages'
import type { Photo } from '../network/contract'

/** Картинка строки чата: `url` появляется, когда миниатюра загружена, и исчезает, когда её вытеснили. */
export type ChatPhoto = { id: string; alt: string; url: string | null; /** Само фото: по клику открывается крупно. */ full: Photo }

/**
 * Не больше шести миниатюр в чате: «до шести миниатюр» из api.md §3. Пока открыт альбом со своими шестью,
 * чатовые освобождены (`suspend`), так что вместе они этот предел не превышают.
 */
export const CHAT_THUMB_MAX = 6

export const chatThumbKey = (id: string): string => `photo:chat:${id}`

type Entry = { id: string; target: ChatPhoto; url: string | null; dead: boolean }

/** Миниатюры фото в общем чате: учёт в бюджете кеша, вытеснение старых, пауза на время альбома. */
export class ChatThumbs {
  private readonly d: ImageDeps & { onChange(): void }
  private entries: Entry[] = []
  private suspended = false
  /** Строки, которым миниатюра положена, но на паузе (альбом открыт) её не грузили или освободили. */
  private waiting: ChatPhoto[] = []

  constructor(deps: ImageDeps & { onChange(): void }) {
    this.d = deps
  }

  show(target: ChatPhoto, photo: Photo): void {
    if (this.suspended) {
      this.wait(target)
      return
    }
    const same = this.entries.find((e) => e.id === photo.id)
    if (same) this.drop(same)
    while (this.entries.length >= CHAT_THUMB_MAX) this.drop(this.entries[0])
    try {
      this.d.budget.reserve(chatThumbKey(photo.id), photo.thumbnail_bytes)
    } catch (e) {
      console.warn('Миниатюра фото в чате не загружена: нет места в бюджете кеша', e)
      return // в строке остаётся текст
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
      (e) => {
        if (entry.dead) return
        console.warn('Миниатюра фото в чате не загружена', photo.thumbnail_url, e)
        this.drop(entry)
      },
    )
  }

  /** Открыт альбом: его миниатюры важнее, чатовые освобождаются, новые не грузятся. */
  suspend(): void {
    if (this.suspended) return
    this.suspended = true
    for (const e of this.entries) this.wait(e.target)
    this.releaseAll()
  }

  /** Альбом закрыт: строки, оставшиеся без миниатюры из-за паузы, загружаются заново. */
  resume(): void {
    if (!this.suspended) return
    this.suspended = false
    const waiting = this.waiting
    this.waiting = []
    for (const t of waiting) this.show(t, t.full)
  }

  releaseAll(): void {
    for (const e of [...this.entries]) this.drop(e)
  }

  private wait(target: ChatPhoto) {
    this.waiting = [...this.waiting.filter((t) => t !== target), target].slice(-CHAT_THUMB_MAX)
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
