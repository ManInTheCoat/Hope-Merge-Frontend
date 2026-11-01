import { CloseCode } from './contract'

/** Что делать после закрытия игрового WS (api.md §4, таблица кодов). */
export type CloseAction = 'retry' | 'login' | 'replaced' | 'update' | 'stop'

export function closeAction(code: number): CloseAction {
  switch (code) {
    case CloseCode.SessionExpired:
      return 'login'
    case CloseCode.Replaced:
      return 'replaced'
    case CloseCode.UnsupportedProtocol:
      return 'update'
    case CloseCode.Normal:
    case CloseCode.UnsupportedData:
    case CloseCode.PolicyViolation:
    case CloseCode.MessageTooBig:
      return 'stop'
    default:
      return 'retry' // 1011, 1012, 1013 и аномальный обрыв
  }
}

const BASE_DELAYS_MS = [1000, 2000, 4000, 8000]
const MAX_DELAY_MS = 10_000

/** Задержка перед попыткой `attempt` (с нуля): 1, 2, 4, 8, далее 10 с, jitter ±20%. */
export function retryDelayMs(attempt: number, rand: () => number = Math.random): number {
  const base = BASE_DELAYS_MS[attempt] ?? MAX_DELAY_MS
  return Math.round(base * (0.8 + 0.4 * rand()))
}

export type LinkState =
  | { kind: 'online' }
  | { kind: 'waiting'; attempt: number; retryAt: number }
  | { kind: 'connecting'; attempt: number }
  | { kind: 'login' }
  | { kind: 'replaced' }
  | { kind: 'update' }
  /** Закрыто без повторов: 1000 — штатно, 1003/1008/1009 — нарушение протокола. */
  | { kind: 'stopped'; code: number }

/** Итог попытки: `code` — код закрытия сокета, если он закрылся до готовности; null — другой сбой. */
export type ConnectResult = { ok: true } | { ok: false; code: number | null; error: unknown }

export type ReconnectDeps = {
  /** Полный вход в мир: сокет, snapshot, зал, world.ready. `isCurrent` — false, если попытку уже отменили (выход). */
  connect(isCurrent: () => boolean): Promise<ConnectResult>
  /** Проверка сессии после неудачной попытки (api.md §4: 401 → вход, сетевой сбой → повтор). */
  checkMe(): Promise<'ok' | 'unauthenticated' | 'network'>
  schedule(fn: () => void, ms: number): () => void
  now(): number
  rand?(): number
  onState(s: LinkState): void
}

function terminal(action: Exclude<CloseAction, 'retry'>, code: number): LinkState {
  if (action === 'stop') return { kind: 'stopped', code }
  return { kind: action === 'replaced' ? 'replaced' : action === 'update' ? 'update' : 'login' }
}

/** Цикл подключения к игре: первая попытка, повторы по расписанию, остановка по кодам закрытия. */
export class ReconnectLoop {
  private attempt = 0
  private cancelTimer: (() => void) | null = null
  /** Растёт при каждом новом запуске и остановке: результат устаревшей попытки отбрасывается. */
  private generation = 0
  private readonly deps: ReconnectDeps

  constructor(deps: ReconnectDeps) {
    this.deps = deps
  }

  /** Вход в мир сейчас: первый вход и кнопка «Войти в мир». */
  connectNow(): Promise<void> {
    this.clearTimer()
    this.attempt = 0
    return this.run(++this.generation)
  }

  /** Живое соединение закрылось сервером или сетью. */
  handleClose(code: number): void {
    this.clearTimer()
    const gen = ++this.generation
    const action = closeAction(code)
    if (action === 'retry') this.wait(gen)
    else this.deps.onState(terminal(action, code))
  }

  /** «Повторить сейчас» во время ожидания. */
  retryNow(): void {
    this.clearTimer()
    void this.run(++this.generation)
  }

  /** Выход: больше ни одной попытки. */
  stop(): void {
    this.clearTimer()
    this.generation++
  }

  private clearTimer(): void {
    this.cancelTimer?.()
    this.cancelTimer = null
  }

  private wait(gen: number): void {
    const ms = retryDelayMs(this.attempt, this.deps.rand)
    this.deps.onState({ kind: 'waiting', attempt: this.attempt, retryAt: this.deps.now() + ms })
    this.cancelTimer = this.deps.schedule(() => {
      this.cancelTimer = null
      if (gen === this.generation) void this.run(gen)
    }, ms)
  }

  private async run(gen: number): Promise<void> {
    this.deps.onState({ kind: 'connecting', attempt: this.attempt })
    const result = await this.deps.connect(() => gen === this.generation)
    if (gen !== this.generation) return
    if (result.ok) {
      this.attempt = 0
      this.deps.onState({ kind: 'online' })
      return
    }
    if (result.error instanceof Error && result.error.message === 'UNSUPPORTED_PROTOCOL') {
      return this.deps.onState({ kind: 'update' })
    }
    const action = result.code === null ? 'retry' : closeAction(result.code)
    if (action !== 'retry') return this.deps.onState(terminal(action, result.code!))
    // Сокет не дошёл до игры: проверяем, жива ли сессия.
    const me = await this.deps.checkMe()
    if (gen !== this.generation) return
    if (me === 'unauthenticated') return this.deps.onState({ kind: 'login' })
    this.attempt++
    this.wait(gen)
  }
}
