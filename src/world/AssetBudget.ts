import { ContentError } from '../network/api'

type Listener = (used: number, limit: number) => void

/**
 * Учёт удерживаемых байтов контента (api.md, «Учёт бюджета»). Ключ — один файл: общий asset считается
 * один раз. До загрузки держим объявленный размер, после — фактический, без двойного счёта.
 */
export class AssetBudget {
  readonly limit: number
  private readonly entries = new Map<string, number>()
  private total = 0
  private readonly listeners = new Set<Listener>()

  constructor(limit: number) {
    this.limit = limit
  }

  get used(): number {
    return this.total
  }

  reserve(key: string, declared: number): void {
    if (this.entries.has(key)) throw new Error(`Ключ бюджета уже занят: ${key}`)
    if (this.total + declared > this.limit) {
      throw new ContentError(`Превышен бюджет кеша: ${this.total + declared} > ${this.limit} байт`)
    }
    this.set(key, declared)
  }

  settle(key: string, actual: number): void {
    if (!this.entries.has(key)) throw new Error(`Нет резерва для ${key}`)
    this.set(key, actual)
  }

  release(key: string): void {
    const bytes = this.entries.get(key)
    if (bytes === undefined) return
    this.entries.delete(key)
    this.total -= bytes
    this.emit()
  }

  onChange(cb: Listener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private set(key: string, bytes: number) {
    this.total += bytes - (this.entries.get(key) ?? 0)
    this.entries.set(key, bytes)
    this.emit()
  }

  private emit() {
    this.listeners.forEach((cb) => cb(this.total, this.limit))
  }
}
