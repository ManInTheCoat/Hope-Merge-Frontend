import type { ErrorBody } from '../network/contract'
import type { SundayServerEvents } from '../network/sunday'
import { rateLimitText, userErrorText } from './errorText'
import { validateText } from './text'

/** Предел просьбы гиду в кодовых точках (api-sunday.md §6). */
export const GUIDE_ACTION_MAX_LEN = 200

/** Фразы, которые понимает гид: подсказка при UNSUPPORTED_ACTION и пример в поле. */
export const GUIDE_ACTION_EXAMPLES = ['покажи макет', 'убери макет', 'сделай освещение теплее', 'сделай освещение холоднее'] as const

export const validateGuideAction = (raw: string): string | null => validateText(raw, GUIDE_ACTION_MAX_LEN)

export const GUIDE_ACTION_HINT = `Гид понимает такие просьбы: ${GUIDE_ACTION_EXAMPLES.map((p) => `«${p}»`).join(', ')}`

export type GuideEffect = SundayServerEvents['guide.action.completed']['effect']

const EFFECT_TEXT: Record<GuideEffect, string> = {
  show_installation: 'Макет показан',
  hide_installation: 'Макет убран',
  warm_light: 'Освещение стало теплее',
  cool_light: 'Освещение стало холоднее',
}

/** Ответ игроку после `guide.action.completed`. */
export const guideActionDoneText = (effect: string): string => EFFECT_TEXT[effect as GuideEffect] ?? 'Готово'

/** Отказ на просьбу: непонятая фраза подсказывает примеры, остальное — обычные тексты. */
export function guideActionErrorText(e: unknown): string {
  const body = e as Partial<ErrorBody> | null
  switch (body?.code) {
    case 'UNSUPPORTED_ACTION':
      return GUIDE_ACTION_HINT
    case 'OUT_OF_RANGE':
      return 'Подойдите ближе к гиду'
    case 'REVISION_CONFLICT':
      return 'Зал только что изменился, попробуйте ещё раз'
    case 'RATE_LIMITED':
      return rateLimitText(body.retry_after_ms)
  }
  return userErrorText(e)
}
