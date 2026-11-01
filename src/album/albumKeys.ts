export type AlbumKeyContext = {
  /** Фокус в поле ввода: B — буква. */
  typing: boolean
  open: boolean
  /** Открыт крупный просмотр, а не сетка. */
  viewer: boolean
  /** Альбом открывать нельзя: экран входа, чат, диалог гида, админка, карточка экспоната. */
  blocked: boolean
}

export function albumKeyAction(code: string, ctx: AlbumKeyContext): 'open' | 'back' | 'close' | null {
  if (ctx.typing) return null
  if (code === 'KeyB') return ctx.open ? 'close' : ctx.blocked ? null : 'open'
  if (code === 'Escape' && ctx.open) return ctx.viewer ? 'back' : 'close'
  return null
}
