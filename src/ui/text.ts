/** Обрезка по Unicode White_Space, как на сервере (api.md §1). */
export const trimWs = (s: string) => s.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '')

/** Длина в кодовых точках: так считает сервер. */
export const codePoints = (s: string) => [...s].length

/** Счётчик символов показываем, когда до предела осталось немного. */
export function inputMeta(value: string, max: number, showFrom: number, error?: string): string {
  const len = codePoints(trimWs(value))
  const counter = len > showFrom ? `${len} / ${max}` : ''
  return [error, counter].filter(Boolean).join(' · ')
}

/** Текст после trim длиной 1–`max` кодовых точек, иначе null. */
export function validateText(raw: string, max: number): string | null {
  const text = trimWs(raw)
  const len = codePoints(text)
  return len >= 1 && len <= max ? text : null
}
