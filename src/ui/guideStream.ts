/**
 * Ответ гида из `guide.delta` (api.md §7): куски с индексами 0, 1, 2…
 * Показываем только непрерывный префикс; повтор индекса игнорируется.
 */
export class StreamText {
  private pending = new Map<number, string>()
  private prefix = ''
  private next = 0

  push(index: number, text: string): void {
    if (!Number.isInteger(index) || index < this.next || this.pending.has(index)) return
    this.pending.set(index, text)
    while (this.pending.has(this.next)) {
      this.prefix += this.pending.get(this.next)!
      this.pending.delete(this.next)
      this.next++
    }
  }

  get text(): string {
    return this.prefix
  }

  /** Пришли куски после пропущенного индекса. */
  get hasGap(): boolean {
    return this.pending.size > 0
  }
}
