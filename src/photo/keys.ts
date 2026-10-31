export type PhotoKeyContext = {
  /** Фокус в поле ввода: F и G — буквы. */
  typing: boolean
  /** Можно снимать прямо сейчас: игра готова, мышь захвачена, окна закрыты, съёмка не идёт. */
  canShoot: boolean
  /** В памяти есть оригинал последнего снимка. */
  hasPhoto: boolean
}

export function photoKeyAction(code: string, ctx: PhotoKeyContext): 'shoot' | 'download' | null {
  if (ctx.typing) return null
  if (code === 'KeyF') return ctx.canShoot ? 'shoot' : null
  if (code === 'KeyG') return ctx.hasPhoto ? 'download' : null
  return null
}
