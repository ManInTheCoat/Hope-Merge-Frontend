import type { LinkState } from '../network/reconnect'

export type LinkBanner = { text: string; retry: boolean }
export type LinkScreen = { text: string; button: 'enter' | 'reload' }
export type LinkView = { banner: LinkBanner | null; screen: LinkScreen | null }

const NONE: LinkView = { banner: null, screen: null }

/** Что показать игроку о соединении. `firstEntry` — ещё ни разу не были в игре: тогда это вход, а не переподключение. */
export function linkView(state: LinkState, now: number, firstEntry = false): LinkView {
  switch (state.kind) {
    case 'waiting': {
      const s = Math.max(1, Math.ceil((state.retryAt - now) / 1000))
      return { banner: { text: `Связь потеряна. Переподключение через ${s} с…`, retry: true }, screen: null }
    }
    case 'connecting':
      return firstEntry ? NONE : { banner: { text: 'Переподключение…', retry: false }, screen: null }
    case 'replaced':
      return { banner: null, screen: { text: 'Игра открыта в другой вкладке', button: 'enter' } }
    case 'update':
      return { banner: null, screen: { text: 'Версия клиента устарела — обновите страницу', button: 'reload' } }
    case 'stopped':
      return { banner: null, screen: { text: state.code === 1000 ? 'Соединение закрыто' : 'Ошибка протокола', button: 'enter' } }
    default:
      return NONE
  }
}
