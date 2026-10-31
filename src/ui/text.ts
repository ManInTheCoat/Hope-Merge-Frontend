/** Обрезка по Unicode White_Space, как на сервере (api.md §1). */
export const trimWs = (s: string) => s.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '')

/** Длина в кодовых точках: так считает сервер. */
export const codePoints = (s: string) => [...s].length

/** Текст после trim длиной 1–`max` кодовых точек, иначе null. */
export function validateText(raw: string, max: number): string | null {
  const text = trimWs(raw)
  const len = codePoints(text)
  return len >= 1 && len <= max ? text : null
}
