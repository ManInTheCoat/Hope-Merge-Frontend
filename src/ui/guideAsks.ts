import type { ErrorBody, Generation } from '../network/contract'
import { codePoints, trimWs } from './authForm'
import { StreamText } from './guideStream'

export const GUIDE_MAX_LEN = 2000

/** Текст вопроса после trim в кодовых точках 1–2000, иначе null (api.md §7). */
export function validateGuideText(raw: string): string | null {
  const text = trimWs(raw)
  const len = codePoints(text)
  return len >= 1 && len <= GUIDE_MAX_LEN ? text : null
}

const seconds = (ms: number | undefined, fallbackMs: number) => Math.ceil((ms ?? fallbackMs) / 1000)

/** Отказ сервера до `guide.accepted`: генерация не создана. */
export function askErrorText(body: Partial<ErrorBody>): string {
  switch (body.code) {
    case 'OUT_OF_RANGE':
      return 'Подойдите ближе к гиду'
    case 'GUIDE_BUSY':
      return 'Гид ещё отвечает на прошлый вопрос'
    case 'GUIDE_QUEUE_FULL':
      return `Гиды заняты, попробуйте через ${seconds(body.retry_after_ms, 5000)} с`
    case 'RATE_LIMITED':
      return `Слишком часто, подождите ${seconds(body.retry_after_ms, 1000)} с`
  }
  return body.message ?? 'Что-то пошло не так'
}

/** Пометка под ответом, завершившимся failed. */
export function failureText(err: Generation['error']): string {
  if (!err) return 'Ответ не получен'
  switch (err.code) {
    case 'CANCELLED':
      return 'Отменено'
    case 'SERVER_RESTARTED':
      return 'Сервер перезапускался'
    case 'AI_TIMEOUT':
      return 'Гид не успел ответить'
    case 'AI_UNAVAILABLE':
      return 'Гид сейчас недоступен'
    case 'AI_OUTPUT_LIMIT':
      return 'Ответ оказался слишком длинным'
  }
  return err.message
}

export type DialogEntry = {
  /** generation.id, до accepted — request_id. */
  key: string
  question: string
  /** '' — текста ещё нет. */
  answer: string
  state: 'waiting' | 'answering' | 'done' | 'failed'
  /** Только для failed. */
  note: string | null
}

export type AskStatus = { text: string; canCancel: boolean }

type Active = {
  requestId: string
  guideId: string
  guideName: string
  question: string
  generationId: string | null
  phase: 'waiting' | 'answering'
  stream: StreamText
}

type Finished = { gen: Generation; partial: string }

function fromHistory(g: Generation): DialogEntry {
  const base = { key: g.id, question: g.user_message.text, answer: g.assistant_message?.text ?? '', note: null }
  switch (g.status) {
    case 'queued':
      return { ...base, state: 'waiting' }
    case 'running':
      return { ...base, state: 'answering' }
    case 'completed':
      return { ...base, state: 'done' }
    case 'failed':
      return { ...base, state: 'failed', note: failureText(g.error) }
  }
}

function fromFinished({ gen, partial }: Finished): DialogEntry {
  if (gen.status === 'completed') return fromHistory(gen)
  return { ...fromHistory(gen), answer: partial }
}

/**
 * Вопросы гидам в рамках одной сессии WS. Незавершённый вопрос один на пользователя (`GUIDE_BUSY`),
 * поэтому и здесь он один. Завершённые храним до `reset()`, чтобы панель показывала их без перезагрузки истории.
 */
export class GuideAsks {
  private current: Active | null = null
  private done: Finished[] = []
  private isCancelling = false
  private listeners = new Set<() => void>()

  get active(): { requestId: string; guideId: string; guideName: string; generationId: string | null } | null {
    const a = this.current
    return a && { requestId: a.requestId, guideId: a.guideId, guideName: a.guideName, generationId: a.generationId }
  }

  get cancelling(): boolean {
    return this.isCancelling
  }

  start(a: { requestId: string; guideId: string; guideName: string; question: string }): void {
    if (this.current) return
    this.current = { ...a, generationId: null, phase: 'waiting', stream: new StreamText() }
    this.emit()
  }

  accepted(requestId: string, gen: Generation): void {
    const a = this.current
    if (!a || a.requestId !== requestId) return
    a.generationId = gen.id
    if (gen.status === 'completed' || gen.status === 'failed') return this.finished(gen)
    a.phase = gen.status === 'running' ? 'answering' : 'waiting'
    this.emit()
  }

  started(generationId: string): void {
    const a = this.current
    if (!a || a.generationId !== generationId) return
    a.phase = 'answering'
    this.emit()
  }

  delta(generationId: string, index: number, text: string): void {
    const a = this.current
    if (!a || a.generationId !== generationId) return
    a.phase = 'answering'
    a.stream.push(index, text)
    this.emit()
  }

  finished(gen: Generation): void {
    const a = this.current
    if (!a) return
    const ours = a.generationId === null ? a.requestId === gen.request_id : a.generationId === gen.id
    if (!ours) return
    this.done.push({ gen, partial: a.stream.text })
    this.current = null
    this.isCancelling = false
    this.emit()
  }

  rejected(requestId: string): string | null {
    const a = this.current
    if (!a || a.requestId !== requestId || a.generationId !== null) return null
    this.current = null
    this.emit()
    return a.question
  }

  setCancelling(v: boolean): void {
    if (this.isCancelling === v) return
    this.isCancelling = v
    this.emit()
  }

  entries(guideId: string, history: readonly Generation[]): DialogEntry[] {
    const live = new Map<string, DialogEntry>()
    for (const f of this.done) if (f.gen.guide_id === guideId) live.set(f.gen.id, fromFinished(f))
    const a = this.current
    let activeEntry: DialogEntry | null = null
    if (a && a.guideId === guideId) {
      activeEntry = { key: a.generationId ?? a.requestId, question: a.question, answer: a.stream.text, state: a.phase, note: null }
    }
    const used = new Set<string>()
    const out = history.map((g) => {
      const e = g.id === activeEntry?.key ? activeEntry : live.get(g.id)
      if (!e) return fromHistory(g)
      used.add(g.id)
      return e
    })
    for (const [id, e] of live) if (!used.has(id)) out.push(e)
    if (activeEntry && !used.has(activeEntry.key)) out.push(activeEntry)
    return out
  }

  status(guideId: string): AskStatus | null {
    const a = this.current
    if (!a) return null
    const text = a.guideId !== guideId ? `Ждём ответ: ${a.guideName}` : a.phase === 'answering' ? 'Гид отвечает…' : 'Ожидание…'
    return { text, canCancel: a.generationId !== null && !this.isCancelling }
  }

  reset(): void {
    this.current = null
    this.done = []
    this.isCancelling = false
    this.emit()
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(): void {
    this.listeners.forEach((cb) => cb())
  }
}
