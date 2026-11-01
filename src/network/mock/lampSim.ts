import type { SundayRoomRuntime, SundayServerEvents } from '../sunday'

/** Серверные правила светильника (api-sunday.md §4) и просьб к гиду (§6), без сети и часов. */

export type GuideEffect = SundayServerEvents['guide.action.completed']['effect']

/** Точные фразы таблицы §6 после нормализации. Ничего, кроме них, сервер не распознаёт. */
const PHRASES: Record<string, GuideEffect> = {
  'покажи макет': 'show_installation',
  'добавь макет': 'show_installation',
  'покажи учебный макет': 'show_installation',
  'убери макет': 'hide_installation',
  'скрой макет': 'hide_installation',
  'сделай освещение теплее': 'warm_light',
  'тёплый свет': 'warm_light',
  'сделай освещение холоднее': 'cool_light',
  'холодный свет': 'cool_light',
}

/** Unicode lower + trim, сжатие пробелов, затем срезаются завершающие `.!?;` (как Go `strings.TrimRight`). */
export function normalizeGuideAction(text: string): string {
  return text
    .toLowerCase()
    .replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '')
    .replace(/\p{White_Space}+/gu, ' ')
    .replace(/[.!?;]+$/, '')
}

/** Эффект просьбы или null — тогда сервер отвечает UNSUPPORTED_ACTION и мир не меняется. */
export function classifyGuideAction(text: string): GuideEffect | null {
  return PHRASES[normalizeGuideAction(text)] ?? null
}

/** Применяет эффект к runtime. Каждое принятое действие повышает revision, даже если оно уже применено. */
export function applyGuideEffect(rt: SundayRoomRuntime, effect: GuideEffect): void {
  switch (effect) {
    case 'show_installation':
      rt.config.installation_visible = true
      break
    case 'hide_installation':
      rt.config.installation_visible = false
      break
    case 'warm_light':
      rt.config.lighting = 'warm'
      break
    case 'cool_light':
      rt.config.lighting = 'cool'
      break
  }
  rt.revision += 1
}

/** Поля команды `object.act` (все, кроме общих, — по действию). */
export type ObjectActPayload = {
  object_id: string
  action: string
  slot_id?: string
  yaw?: number
  head_pitch?: number
  on?: boolean
}

export type ActFailure = { code: 'VALIDATION_ERROR' | 'OBJECT_BUSY'; message: string }

const HEAD_PITCH_MAX = Math.PI / 3
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Состав полей по действию: нужные есть и в пределах, лишних нет. */
export function checkActShape(p: ObjectActPayload): ActFailure | null {
  const bad = (message: string): ActFailure => ({ code: 'VALIDATION_ERROR', message })
  const extras = (...allowed: string[]) =>
    (['slot_id', 'yaw', 'head_pitch', 'on'] as const).some((k) => p[k] !== undefined && !allowed.includes(k))
  switch (p.action) {
    case 'take':
      return extras() ? bad('Лишние поля') : null
    case 'place':
      if (extras('slot_id')) return bad('Лишние поля')
      return p.slot_id === 'a' || p.slot_id === 'b' ? null : bad('slot_id: a или b')
    case 'aim':
      if (extras('yaw', 'head_pitch')) return bad('Лишние поля')
      if (!finite(p.yaw) || !finite(p.head_pitch)) return bad('Нужны yaw и head_pitch')
      if (p.yaw < -Math.PI || p.yaw >= Math.PI) return bad('yaw вне [−π, π)')
      return Math.abs(p.head_pitch) > HEAD_PITCH_MAX ? bad('head_pitch вне [−π/3, π/3]') : null
    case 'power':
      if (extras('on')) return bad('Лишние поля')
      return typeof p.on === 'boolean' ? null : bad('Нужно поле on')
    }
  return bad('Неизвестное действие')
}

/** Слот-цель для проверки расстояния: у place — выбранный, у остальных — тот, где лампа стоит (или стояла). */
export function actSlotPosition(rt: SundayRoomRuntime, p: ObjectActPayload): { x: number; z: number } | null {
  const id = p.action === 'place' ? p.slot_id : rt.lamp.slot_id
  return rt.config.lamp_slots.find((s) => s.slot_id === id)?.position ?? null
}

/** Владение: take — лампа должна стоять, place — держит сам игрок, aim/power — лампа стоит. Чужая ничья. */
export function checkActState(rt: SundayRoomRuntime, userId: string, p: ObjectActPayload): ActFailure | null {
  const holder = rt.lamp.holder_user_id
  const busy = (message: string): ActFailure => ({ code: 'OBJECT_BUSY', message })
  switch (p.action) {
    case 'take':
      return holder === null ? null : busy(holder === userId ? 'Лампа уже у вас' : 'Лампу держит другой игрок')
    case 'place':
      return holder === userId ? null : busy(holder === null ? 'Лампа не в руках' : 'Лампу держит другой игрок')
    default:
      return holder === null ? null : busy('Лампа в руках')
  }
}

/** Применяет проверенную команду; каждая успешная повышает revision, даже со старыми значениями. */
export function applyObjectAct(rt: SundayRoomRuntime, userId: string, p: ObjectActPayload): void {
  switch (p.action) {
    case 'take':
      rt.lamp.holder_user_id = userId
      break
    case 'place':
      rt.lamp.slot_id = p.slot_id as 'a' | 'b'
      rt.lamp.holder_user_id = null
      break
    case 'aim':
      rt.lamp.yaw = p.yaw!
      rt.lamp.head_pitch = p.head_pitch!
      break
    case 'power':
      rt.lamp.on = p.on!
      break
  }
  rt.revision += 1
}

/** Disconnect, замена соединения или дверь: лампа возвращается на последний слот (api-sunday.md §4). */
export function releaseLamp(rt: SundayRoomRuntime, userId: string): boolean {
  if (rt.lamp.holder_user_id !== userId) return false
  rt.lamp.holder_user_id = null
  rt.revision += 1
  return true
}
