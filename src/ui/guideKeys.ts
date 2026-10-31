export type PanelKeyContext = {
  /** Фокус в поле ввода: E — обычная буква. */
  typing: boolean
  /** Поле заблокировано, пока гид отвечает: печатать нельзя, E снова служит для закрытия. */
  inputDisabled: boolean
  /** Это нажатие только что открыло панель (его погасил обработчик взаимодействия). */
  opening: boolean
}

/**
 * Закрывает ли клавиша открытую панель гида. Закрываем только по E: после него мышь можно сразу
 * захватить снова. Esc браузер не считает действием пользователя, захват по нему не вернуть,
 * и игрок попал бы на затемнение «Кликните, чтобы продолжить».
 */
export function panelKeyAction(code: string, ctx: PanelKeyContext): 'close' | null {
  if (code !== 'KeyE' || ctx.opening) return null
  if (ctx.typing && !ctx.inputDisabled) return null
  return 'close'
}
