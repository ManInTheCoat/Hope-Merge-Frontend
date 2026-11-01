import type { Photo } from '../network/contract'
import { userErrorText } from '../ui/errorText'
import { AlbumImages, type ImageDeps } from './albumImages'
import { AlbumPager, type FetchPage } from './albumPager'

export type AlbumState =
  | { kind: 'loading' }
  | { kind: 'error'; text: string }
  | {
      kind: 'grid'
      items: readonly Photo[]
      thumbs: ReadonlyMap<string, string>
      hasPrev: boolean
      hasNext: boolean
      busy: boolean
      notice: string | null
    }
  | { kind: 'viewer'; photo: Photo; url: string | null; notice: string | null }

export type AlbumDeps = ImageDeps & { fetchPage: FetchPage }

/**
 * Состояние экрана альбома: страницы, миниатюры, просмотр. Не знает о DOM; панель только рисует `AlbumState`.
 * `close()` отменяет все начатые операции: после него состояния не выдаются, а бюджет и object URL свободны.
 */
export class AlbumController {
  private readonly pager: AlbumPager
  private readonly images: AlbumImages
  private readonly onState: (s: AlbumState) => void
  private token = 0
  private ac: AbortController | null = null
  private busy = false
  private thumbs: ReadonlyMap<string, string> = new Map()
  private viewing: { photo: Photo; blob: Blob | null } | null = null
  private viewUrl: string | null = null

  constructor(deps: AlbumDeps, onState: (s: AlbumState) => void) {
    this.pager = new AlbumPager(deps.fetchPage)
    this.images = new AlbumImages(deps)
    this.onState = onState
  }

  get isViewer(): boolean {
    return this.viewing !== null
  }

  /** Оригинал открытого фото, пока он загружен (для скачивания). */
  get viewed(): { photo: Photo; blob: Blob } | null {
    const v = this.viewing
    return v?.blob ? { photo: v.photo, blob: v.blob } : null
  }

  /** Открывает первую страницу; после `error` служит повтором. */
  async open(): Promise<void> {
    this.reset()
    const t = this.token
    this.busy = true
    this.onState({ kind: 'loading' })
    try {
      await this.pager.first(this.ac!.signal)
      if (t !== this.token) return
      this.grid(true, null)
      this.thumbs = await this.images.loadThumbs(this.pager.items, this.ac!.signal)
      if (t !== this.token) return
      this.busy = false
      this.grid(false, null)
    } catch (e) {
      if (t !== this.token) return
      this.busy = false
      this.onState({ kind: 'error', text: userErrorText(e) })
    }
  }

  next(): Promise<void> {
    return this.turn((s) => this.pager.next(s))
  }

  prev(): Promise<void> {
    return this.turn((s) => this.pager.prev(s))
  }

  async view(photoId: string): Promise<void> {
    const photo = this.pager.items.find((p) => p.id === photoId)
    if (this.busy || this.viewing || !photo || !this.ac) return
    const t = this.token
    this.busy = true
    this.viewing = { photo, blob: null }
    this.onState({ kind: 'viewer', photo, url: null, notice: null })
    try {
      const { url, blob } = await this.images.openOriginal(photo, this.ac.signal)
      if (t !== this.token) return
      this.busy = false
      this.viewUrl = url
      this.viewing = { photo: this.viewing?.photo ?? photo, blob }
      this.onState({ kind: 'viewer', photo: this.viewing.photo, url, notice: null })
    } catch (e) {
      if (t !== this.token) return
      this.busy = false
      this.viewing = null
      this.viewUrl = null
      this.grid(false, userErrorText(e))
    }
  }

  backToGrid(): void {
    if (!this.viewing) return
    this.images.closeOriginal()
    this.viewing = null
    this.viewUrl = null
    this.busy = false
    this.grid(false, null)
  }

  /** После отправки в чат фото публичное: обновляем и страницу, и открытый просмотр. */
  markPublished(photoId: string): void {
    const photo = this.pager.items.find((p) => p.id === photoId)
    if (!photo) return
    const updated = { ...photo, published: true }
    this.pager.replace(updated)
    if (this.viewing?.photo.id === photoId) {
      this.viewing = { ...this.viewing, photo: updated }
      this.onState({ kind: 'viewer', photo: updated, url: this.viewUrl, notice: null })
    } else if (!this.viewing) this.grid(this.busy, null)
  }

  close(): void {
    this.token++
    this.ac?.abort()
    this.ac = null
    this.images.releaseAll()
    this.viewing = null
    this.viewUrl = null
    this.thumbs = new Map()
    this.busy = false
  }

  private reset() {
    this.close()
    this.ac = new AbortController()
  }

  private async turn(load: (signal: AbortSignal) => Promise<readonly Photo[]>): Promise<void> {
    if (this.busy || this.viewing || !this.ac) return
    const t = this.token
    this.busy = true
    this.grid(true, null)
    try {
      await load(this.ac.signal)
      if (t !== this.token) return
      this.thumbs = await this.images.loadThumbs(this.pager.items, this.ac.signal)
      if (t !== this.token) return
      this.busy = false
      this.grid(false, null)
    } catch (e) {
      if (t !== this.token) return
      this.busy = false
      this.grid(false, userErrorText(e))
    }
  }

  private grid(busy: boolean, notice: string | null) {
    this.onState({
      kind: 'grid',
      items: this.pager.items,
      thumbs: this.thumbs,
      hasPrev: this.pager.hasPrev,
      hasNext: this.pager.hasNext,
      busy,
      notice,
    })
  }
}
