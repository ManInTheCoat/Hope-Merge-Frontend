import type { Photo } from '../network/contract'
import type { AssetBudget } from '../world/AssetBudget'

export const thumbKey = (id: string): string => `photo:thumb:${id}`
export const VIEW_KEY = 'photo:view'

export type ImageDeps = {
  budget: AssetBudget
  fetchBlob(url: string, maxBytes: number, signal?: AbortSignal): Promise<Blob>
  makeUrl(blob: Blob): string
  revokeUrl(url: string): void
}

/**
 * Память альбома: миниатюры текущей страницы и один оригинал в просмотре. Байты резервируются по объявленным
 * размерам до запроса и заменяются фактическими; новая страница или новый оригинал освобождает прежние.
 * Счётчики поколений отсекают устаревшие загрузки: они ничего не оставляют ни в бюджете, ни в object URL.
 */
export class AlbumImages {
  private readonly d: ImageDeps
  private thumbGen = 0
  private viewGen = 0
  private thumbs = new Map<string, string | null>()
  private view: string | null = null

  constructor(deps: ImageDeps) {
    this.d = deps
  }

  async loadThumbs(photos: readonly Photo[], signal?: AbortSignal): Promise<Map<string, string>> {
    const gen = ++this.thumbGen
    this.releaseThumbs()
    const wanted: Photo[] = []
    for (const p of photos) {
      try {
        this.d.budget.reserve(thumbKey(p.id), p.thumbnail_bytes)
      } catch {
        continue // нет места в бюджете: у этой карточки не будет миниатюры
      }
      this.thumbs.set(p.id, null)
      wanted.push(p)
    }
    await Promise.all(
      wanted.map(async (p) => {
        let blob: Blob
        try {
          blob = await this.d.fetchBlob(p.thumbnail_url, p.thumbnail_bytes, signal)
        } catch {
          if (gen === this.thumbGen) this.dropThumb(p.id)
          return
        }
        if (gen !== this.thumbGen) return // страницу уже сменили: резервы освободил новый вызов
        this.d.budget.settle(thumbKey(p.id), blob.size)
        this.thumbs.set(p.id, this.d.makeUrl(blob))
      }),
    )
    const out = new Map<string, string>()
    if (gen !== this.thumbGen) return out
    for (const [id, url] of this.thumbs) if (url) out.set(id, url)
    return out
  }

  async openOriginal(photo: Photo, signal?: AbortSignal): Promise<{ url: string; blob: Blob }> {
    const gen = ++this.viewGen
    this.releaseView()
    this.d.budget.reserve(VIEW_KEY, photo.image_bytes)
    let blob: Blob
    try {
      blob = await this.d.fetchBlob(photo.image_url, photo.image_bytes, signal)
    } catch (e) {
      if (gen === this.viewGen) this.releaseView()
      throw e
    }
    if (gen !== this.viewGen) throw new Error('Просмотр отменён')
    this.d.budget.settle(VIEW_KEY, blob.size)
    this.view = this.d.makeUrl(blob)
    return { url: this.view, blob }
  }

  closeOriginal(): void {
    this.viewGen++
    this.releaseView()
  }

  releaseAll(): void {
    this.thumbGen++
    this.releaseThumbs()
    this.closeOriginal()
  }

  private dropThumb(id: string) {
    const url = this.thumbs.get(id)
    if (url) this.d.revokeUrl(url)
    this.thumbs.delete(id)
    this.d.budget.release(thumbKey(id))
  }

  private releaseThumbs() {
    for (const id of [...this.thumbs.keys()]) this.dropThumb(id)
  }

  private releaseView() {
    if (this.view) this.d.revokeUrl(this.view)
    this.view = null
    this.d.budget.release(VIEW_KEY)
  }
}
