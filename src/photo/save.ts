import { ApiError } from '../network/api'
import type { Photo } from '../network/contract'
import { uuidV4 } from '../network/uuid'
import { rateLimitText } from '../ui/errorText'

/** Снимок с полями запроса. Ключ один на снимок: повтор после потерянного ответа идёт с ним же. */
export type Shot = { key: string; blob: Blob; roomId: string; epoch: number; exhibitId: string | null; takenAt: Date }

export type Upload = (form: FormData, key: string, signal: AbortSignal) => Promise<Photo>

export type SaveOptions = {
  signal?: AbortSignal
  totalMs?: number
  retryDelaysMs?: number[]
  /** Сервер не принял экспонат: дальше отправляется этот снимок (без экспоната, с новым ключом). */
  onFallback?: (shot: Shot) => void
}

const TOTAL_MS = 15_000
const RETRY_DELAYS_MS = [1000, 2000]

export class PhotoTimeoutError extends Error {
  constructor() {
    super('Сервер не ответил')
  }
}

export function buildPhotoForm(shot: Shot): FormData {
  const form = new FormData()
  form.append('image', shot.blob, 'photo.jpg')
  form.append('room_id', shot.roomId)
  form.append('movement_epoch', String(shot.epoch))
  if (shot.exhibitId !== null) form.append('exhibit_id', shot.exhibitId)
  return form
}

const abortError = (signal: AbortSignal) => signal.reason ?? new DOMException('Aborted', 'AbortError')

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError(signal))
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      done()
      reject(abortError(signal))
    }
    const timer = setTimeout(() => {
      done()
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort)
  })
}

/**
 * Загружает снимок. Сетевой сбой — повтор с тем же ключом и тем же телом. Ответ с кодом ошибки не
 * повторяется, кроме одного отката без `exhibit_id` (и с новым ключом: это уже другой запрос), если
 * сервер не принял экспонат. При откате вызывается `onFallback` с новым снимком, чтобы ручной повтор шёл с актуальным ключом.
 * Общий таймаут обрывает текущий запрос и отменяет оставшиеся попытки.
 */
export async function savePhoto(original: Shot, upload: Upload, opts: SaveOptions = {}): Promise<{ photo: Photo; shot: Shot }> {
  let shot = original
  const delays = opts.retryDelaysMs ?? RETRY_DELAYS_MS
  const ac = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ac.abort()
  }, opts.totalMs ?? TOTAL_MS)
  const outer = opts.signal
  const onOuterAbort = () => ac.abort(outer?.reason)
  if (outer?.aborted) onOuterAbort()
  outer?.addEventListener('abort', onOuterAbort)

  const fail = (e: unknown): never => {
    if (timedOut) throw new PhotoTimeoutError()
    if (outer?.aborted) throw abortError(outer)
    throw e
  }

  try {
    let netRetries = 0
    let fellBack = false
    for (;;) {
      if (ac.signal.aborted) fail(abortError(ac.signal))
      try {
        return { photo: await upload(buildPhotoForm(shot), shot.key, ac.signal), shot }
      } catch (e) {
        if (ac.signal.aborted) fail(e)
        if (e instanceof ApiError) {
          const exhibitRejected = e.code === 'OUT_OF_RANGE' || e.code === 'NOT_FOUND'
          if (exhibitRejected && shot.exhibitId !== null && !fellBack) {
            fellBack = true
            shot = { ...shot, exhibitId: null, key: uuidV4() }
            opts.onFallback?.(shot)
            continue
          }
          throw e
        }
        if (netRetries >= delays.length) throw e
        try {
          await sleep(delays[netRetries++], ac.signal)
        } catch (abortErr) {
          fail(abortErr)
        }
      }
    }
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', onOuterAbort)
  }
}

export function photoErrorText(e: unknown): string {
  if (e instanceof PhotoTimeoutError) return e.message
  if (!(e instanceof ApiError)) return 'Нет связи с сервером'
  if (e.code === 'RATE_LIMITED') return rateLimitText(e.retryAfterMs)
  return e.message
}
