import type { AssetBudget } from '../world/AssetBudget'
import { MAX_PHOTO_BYTES } from './frame'

/** Префикс `photo:` оставляет место миниатюрам альбома (`photo:thumb:<id>`) без смены схемы. */
export const PHOTO_BUDGET_KEY = 'photo:original'

const pad = (n: number) => String(n).padStart(2, '0')

export function photoFileName(roomId: string, takenAt: Date): string {
  const d = takenAt
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `museum-${roomId}-${date}-${time}.jpg`
}

export function downloadBlob(url: string, fileName: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/**
 * Единственный оригинал фото в памяти и его учёт в бюджете кеша (api.md §3): перед новой съёмкой
 * прежний освобождается, до кодирования держим резерв 2 МиБ, после — фактический размер.
 */
export class LastPhoto {
  private readonly budget: AssetBudget
  private _blob: Blob | null = null
  private _url: string | null = null
  private _fileName: string | null = null

  constructor(budget: AssetBudget) {
    this.budget = budget
  }

  get blob(): Blob | null {
    return this._blob
  }

  get url(): string | null {
    return this._url
  }

  get fileName(): string | null {
    return this._fileName
  }

  begin(): void {
    this.release()
    this.budget.reserve(PHOTO_BUDGET_KEY, MAX_PHOTO_BYTES)
  }

  commit(blob: Blob, roomId: string, takenAt: Date): void {
    this.budget.settle(PHOTO_BUDGET_KEY, blob.size)
    this._blob = blob
    this._url = URL.createObjectURL(blob)
    this._fileName = photoFileName(roomId, takenAt)
  }

  release(): void {
    this.budget.release(PHOTO_BUDGET_KEY)
    if (this._url) URL.revokeObjectURL(this._url)
    this._blob = null
    this._url = null
    this._fileName = null
  }
}
