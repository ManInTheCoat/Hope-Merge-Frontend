import type { SundayAdminGuide, SundayGuideSettings } from '../network/sunday'
import { codePoints, trimWs } from '../ui/text'

/** Черновик формы гида: ограничения — одно на строку, остальное как в `SundayGuideSettings`. */
export type GuideDraft = {
  display_name: string
  subtitle: string
  personality: string
  style: string
  topic: string
  constraints: string
  material_ids: string[]
}

const TEXT_LIMITS = { display_name: 64, subtitle: 200, personality: 2000, style: 1000, topic: 1000 } as const
const CONSTRAINTS_MAX = 20
const CONSTRAINT_MAX = 1000
const SUM_MAX = 4000
const MATERIALS_MAX = 100

export function guideToDraft(g: SundayAdminGuide): GuideDraft {
  const s = g.settings
  return { ...s, constraints: s.constraints.join('\n'), material_ids: [...s.material_ids] }
}

/** Строки ограничений после trim, без пустых. */
const constraintLines = (raw: string): string[] => raw.split('\n').map(trimWs).filter((l) => l !== '')

export function draftToSettings(d: GuideDraft): SundayGuideSettings {
  return {
    display_name: trimWs(d.display_name),
    subtitle: trimWs(d.subtitle),
    personality: trimWs(d.personality),
    style: trimWs(d.style),
    topic: trimWs(d.topic),
    constraints: constraintLines(d.constraints),
    material_ids: [...d.material_ids],
  }
}

/** Ошибки по именам полей; пустой объект — черновик можно отправлять. Окончательно решает сервер. */
export function validateGuideDraft(d: GuideDraft, available: readonly string[]): Record<string, string> {
  const errors: Record<string, string> = {}
  const s = draftToSettings(d)
  for (const key of Object.keys(TEXT_LIMITS) as Array<keyof typeof TEXT_LIMITS>) {
    const len = codePoints(s[key])
    if (len < 1 || len > TEXT_LIMITS[key]) errors[key] = `От 1 до ${TEXT_LIMITS[key]} символов`
    else if (s[key].includes('\u0000')) errors[key] = 'Недопустимый символ'
  }
  const lines = s.constraints
  if (lines.length < 1 || lines.length > CONSTRAINTS_MAX) {
    errors.constraints = `От 1 до ${CONSTRAINTS_MAX} ограничений, по одному на строку`
  } else if (lines.some((l) => codePoints(l) > CONSTRAINT_MAX)) {
    errors.constraints = `Каждое ограничение — до ${CONSTRAINT_MAX} символов`
  } else if (lines.some((l) => l.includes('\u0000'))) {
    errors.constraints = 'Недопустимый символ'
  }
  const known = new Set(available)
  if (
    s.material_ids.length > MATERIALS_MAX ||
    new Set(s.material_ids).size !== s.material_ids.length ||
    s.material_ids.some((id) => !known.has(id))
  ) {
    errors.material_ids = 'Выберите материалы из доступных'
  }
  if (Object.keys(errors).length === 0) {
    const sum = [s.personality, s.style, s.topic, ...lines].reduce((n, t) => n + codePoints(t), 0)
    if (sum > SUM_MAX) errors.personality = `Личность, стиль, тема и ограничения вместе — до ${SUM_MAX} символов`
  }
  return errors
}
