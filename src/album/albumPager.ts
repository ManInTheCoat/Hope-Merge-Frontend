import type { Photo, PhotosPage } from '../network/contract'

export type FetchPage = (cursor: string | null, signal?: AbortSignal) => Promise<PhotosPage>

/**
 * Страницы альбома: показывается одна, прежняя заменяется (в памяти не больше шести миниатюр, api.md §3).
 * Курсоры пройденных страниц хранятся здесь, поэтому «Назад» не зависит от обратных курсоров сервера.
 * Состояние меняется только после успешной загрузки.
 */
export class AlbumPager {
  private readonly fetchPage: FetchPage
  /** Курсор, которым получена страница с индексом i. */
  private cursors: (string | null)[] = []
  private index = -1
  private page: PhotosPage = { items: [], next_cursor: null }

  constructor(fetchPage: FetchPage) {
    this.fetchPage = fetchPage
  }

  get items(): readonly Photo[] {
    return this.page.items
  }

  get hasPrev(): boolean {
    return this.index > 0
  }

  get hasNext(): boolean {
    return this.page.next_cursor !== null
  }

  async first(signal?: AbortSignal): Promise<readonly Photo[]> {
    return this.go(null, [null], 0, signal)
  }

  async next(signal?: AbortSignal): Promise<readonly Photo[]> {
    const cursor = this.page.next_cursor
    if (cursor === null) return this.items
    return this.go(cursor, [...this.cursors.slice(0, this.index + 1), cursor], this.index + 1, signal)
  }

  async prev(signal?: AbortSignal): Promise<readonly Photo[]> {
    if (!this.hasPrev) return this.items
    return this.go(this.cursors[this.index - 1], this.cursors.slice(0, this.index), this.index - 1, signal)
  }

  /** Подменяет фото с тем же `id` на текущей странице (например, после публикации). */
  replace(photo: Photo): void {
    this.page = { ...this.page, items: this.page.items.map((p) => (p.id === photo.id ? photo : p)) }
  }

  private async go(cursor: string | null, cursors: (string | null)[], index: number, signal?: AbortSignal) {
    const page = await this.fetchPage(cursor, signal)
    this.page = page
    this.cursors = cursors
    this.index = index
    return page.items
  }
}
