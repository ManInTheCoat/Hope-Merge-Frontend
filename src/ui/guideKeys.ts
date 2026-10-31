export type PanelKeyContext = {
  /** Фокус в поле ввода: E — обычная буква. */
  typing: boolean
  /** Поле заблокировано, пока гид отвечает: игрок мог начать набирать следующий вопрос. */
  inputDisabled: boolean
  /** Это нажатие только что открыло панель (его погасил обработчик взаимодействия). */
  opening: boolean
}

/** Что делает клавиша при открытой панели гида: закрыть, закрыть и захватить мышь, или ничего. */
export function panelKeyAction(code: string, ctx: PanelKeyContext): 'close' | 'close-lock' | null {
  if (code === 'Escape') return 'close'
  if (code !== 'KeyE' || ctx.typing || ctx.inputDisabled || ctx.opening) return null
  return 'close-lock'
}
