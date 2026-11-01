import type { SundayMetrics } from './sunday'

/** Период `client.metrics` (api-sunday.md §7). */
export const METRICS_EVERY_MS = 2000

/** Среднее число кадров в секунду за окно между двумя отчётами. */
export class FpsMeter {
  private start = 0
  private frames = 0

  /** Один кадр отрисован. */
  frame(): void {
    this.frames += 1
  }

  /** Начинает окно заново: кадры до `now` в среднее не входят (скрытая вкладка, смена сокета). */
  reset(now: number): void {
    this.start = now
    this.frames = 0
  }

  /** FPS за окно с прошлого отчёта (конечное, 0..1000, один знак после запятой) и начало нового окна; null — окно нулевой длины. */
  take(now: number): number | null {
    const elapsed = now - this.start
    const frames = this.frames
    this.reset(now)
    if (!(elapsed > 0)) return null
    return Math.round(Math.min(1000, (frames * 1000) / elapsed) * 10) / 10
  }
}

/** То, что нужно телеметрии от сокета: подходит и `GameSocket`, и заглушка в тестах. */
export type TelemetrySocket = {
  send(type: 'client.metrics', payload: SundayMetrics): unknown
  send(type: 'telemetry.pong', payload: { nonce: string }): unknown
  on(type: 'telemetry.probe', handler: (payload: { nonce: string }) => void): () => void
  onClose(handler: (code: number) => void): () => void
}

/** Окружение таймеров и видимости вкладки; в тестах подменяется. */
export type TelemetryEnv = {
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(id: unknown): void
  now(): number
  hidden(): boolean
  onVisibilityChange(handler: () => void): () => void
}

export const browserTelemetryEnv: TelemetryEnv = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
  now: () => performance.now(),
  hidden: () => document.hidden,
  onVisibilityChange: (handler) => {
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  },
}

/**
 * FPS и ping для админки (api-sunday.md §7): `client.metrics` раз в 2 с и `telemetry.pong` на каждый `telemetry.probe`.
 * Оба сообщения без request_id и допустимы до `world.ready`, поэтому запускается сразу после snapshot.
 * Скрытая вкладка сообщает `visible:false, fps:null` сразу и не шлёт фиктивный FPS 0. Останавливается вместе с сокетом.
 */
export function startTelemetry(
  socket: TelemetrySocket,
  meter: FpsMeter,
  env: TelemetryEnv = browserTelemetryEnv,
): () => void {
  const report = () => {
    const now = env.now()
    if (env.hidden()) {
      meter.reset(now)
      socket.send('client.metrics', { fps: null, visible: false })
      return
    }
    const fps = meter.take(now)
    if (fps !== null) socket.send('client.metrics', { fps, visible: true })
  }

  meter.reset(env.now())
  const timer = env.setInterval(report, METRICS_EVERY_MS)
  const offVisibility = env.onVisibilityChange(() => {
    if (env.hidden()) report()
    else meter.reset(env.now()) // кадры до возвращения вкладки в среднее не входят
  })
  const offProbe = socket.on('telemetry.probe', ({ nonce }) => socket.send('telemetry.pong', { nonce }))

  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    env.clearInterval(timer)
    offVisibility()
    offProbe()
    offClose()
  }
  const offClose = socket.onClose(stop)
  return stop
}
