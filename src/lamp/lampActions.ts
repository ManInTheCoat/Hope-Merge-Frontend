import type { ErrorBody } from '../network/contract'
import type { SundayLamp, SundayObjectAct, SundayRoomRuntime } from '../network/sunday'
import { rateLimitText, userErrorText } from '../ui/errorText'
import { wrapAngle } from '../scene/angles'
import { cylinderHitT, sightClear, type LookInput } from '../scene/targeting'

/** Что игрок видит в прицеле: стоящая лампа или место (слот), куда можно поставить лампу из рук. */
export type LampTarget = { kind: 'lamp' } | { kind: 'slot'; slotId: 'a' | 'b' }

/** Подсказку показываем с запасом: сервер проверяет ≤ 3 м по своей, чуть отстающей позиции (api-sunday.md §4). */
export const LAMP_HINT_RADIUS_M = 2.8
const LAMP_HIT_RADIUS_M = 0.55
const LAMP_HIT_HEIGHT_M = 1.6
/** Слот под лампу в руках выбирается по направлению взгляда, а не по точному попаданию в пол. */
const SLOT_VIEW_ANGLE = (40 * Math.PI) / 180
/** Ближе этого слот выбирается при любом повороте: игрок стоит над ним. */
const SLOT_NEAR_M = 0.7
/** Сервер проверяет видимость точки на этой высоте над слотом. */
const LAMP_EYE_HEIGHT_M = 0.6

/** Шаг поворота головки одним нажатием. */
export const AIM_STEP = Math.PI / 12
export const HEAD_PITCH_MAX = Math.PI / 3

/** Смещение перенесённой лампы от игрока: справа и вверх от точки пола (api-sunday.md §2). */
export const HELD_OFFSET = { right: 0.35, up: 1 }

export const holdsLamp = (rt: SundayRoomRuntime | null, userId: string): boolean => !!rt && rt.lamp.holder_user_id === userId

/**
 * Лампа или слот под взглядом и расстояние до него по лучу. Лампа, стоящая на месте, — цель для «взять» и
 * настроек; лампа в руках — только слоты, куда её можно поставить. Чужую лампу в руках не показываем.
 */
export function pickLamp(input: LookInput, rt: SundayRoomRuntime, userId: string): { target: LampTarget; t: number } | null {
  const lamp = rt.lamp
  if (lamp.holder_user_id === null) {
    const slot = rt.config.lamp_slots.find((s) => s.slot_id === lamp.slot_id)
    if (!slot) return null
    const t = cylinderHitT(input, slot.position, LAMP_HIT_RADIUS_M, LAMP_HIT_HEIGHT_M, LAMP_EYE_HEIGHT_M, LAMP_HINT_RADIUS_M)
    return t === null ? null : { target: { kind: 'lamp' }, t }
  }
  if (lamp.holder_user_id !== userId) return null
  const from = input.rangeFrom ?? input.eye
  const viewLen = Math.hypot(input.dir.x, input.dir.z)
  let best: { target: LampTarget; t: number; angle: number } | null = null
  for (const slot of rt.config.lamp_slots) {
    const dx = slot.position.x - from.x
    const dz = slot.position.z - from.z
    const dist = Math.hypot(dx, dz)
    if (dist > LAMP_HINT_RADIUS_M) continue
    // Угол между взглядом и направлением на слот в плоскости пола.
    const angle = dist < 1e-6 || viewLen < 1e-6 ? 0 : Math.acos(Math.max(-1, Math.min(1, (dx * input.dir.x + dz * input.dir.z) / (dist * viewLen))))
    if (dist > SLOT_NEAR_M && angle > SLOT_VIEW_ANGLE) continue
    if (!sightClear(input, { x: slot.position.x, y: LAMP_EYE_HEIGHT_M, z: slot.position.z })) continue
    if (!best || angle < best.angle) best = { target: { kind: 'slot', slotId: slot.slot_id }, t: dist, angle }
  }
  return best && { target: best.target, t: best.t }
}

export const HELD_HINT = 'Лампа в руках: подойдите к месту и нажмите E, чтобы поставить'

/** Подсказка у лампы или слота. */
export function lampHint(target: LampTarget): string {
  if (target.kind === 'slot') return `E — поставить лампу (место ${target.slotId.toUpperCase()})`
  return 'E — взять лампу · Q — вкл/выкл · Z/X — повернуть · C/V — наклонить'
}

/** Клавиши настройки стоящей лампы. */
export type LampKey = 'KeyQ' | 'KeyZ' | 'KeyX' | 'KeyC' | 'KeyV'
export const LAMP_KEYS: ReadonlySet<string> = new Set<LampKey>(['KeyQ', 'KeyZ', 'KeyX', 'KeyC', 'KeyV'])

type Ctx = { movementEpoch: number; revision: number }

const base = (ctx: Ctx) => ({ object_id: 'lamp_01' as const, movement_epoch: ctx.movementEpoch, expected_revision: ctx.revision })

export const takeAct = (ctx: Ctx): SundayObjectAct => ({ ...base(ctx), action: 'take' })
export const placeAct = (ctx: Ctx, slotId: 'a' | 'b'): SundayObjectAct => ({ ...base(ctx), action: 'place', slot_id: slotId })

/** Команда по клавише настройки: питание или шаг головки в допустимых пределах. */
export function keyAct(code: string, lamp: SundayLamp, ctx: Ctx): SundayObjectAct | null {
  switch (code) {
    case 'KeyQ':
      return { ...base(ctx), action: 'power', on: !lamp.on }
    case 'KeyZ':
      return { ...base(ctx), action: 'aim', yaw: wrapAngle(lamp.yaw + AIM_STEP), head_pitch: lamp.head_pitch }
    case 'KeyX':
      return { ...base(ctx), action: 'aim', yaw: wrapAngle(lamp.yaw - AIM_STEP), head_pitch: lamp.head_pitch }
    case 'KeyC':
      return { ...base(ctx), action: 'aim', yaw: lamp.yaw, head_pitch: clampPitch(lamp.head_pitch - AIM_STEP) }
    case 'KeyV':
      return { ...base(ctx), action: 'aim', yaw: lamp.yaw, head_pitch: clampPitch(lamp.head_pitch + AIM_STEP) }
  }
  return null
}

const clampPitch = (p: number) => Math.max(-HEAD_PITCH_MAX, Math.min(HEAD_PITCH_MAX, p))

export type HeldPose = { x: number; z: number; yaw: number }

/** Где висит перенесённая лампа: справа от игрока (при yaw=0 вправо — +X) и на метр выше пола. */
export function heldPosition(p: HeldPose): { x: number; y: number; z: number } {
  return {
    x: p.x + Math.cos(p.yaw) * HELD_OFFSET.right,
    y: HELD_OFFSET.up,
    z: p.z - Math.sin(p.yaw) * HELD_OFFSET.right,
  }
}

/** Текст отказа для игрока. */
export function lampErrorText(e: unknown): string {
  const body = e as Partial<ErrorBody> | null
  switch (body?.code) {
    case 'OBJECT_BUSY':
      return 'Лампу держит другой игрок'
    case 'OUT_OF_RANGE':
      return 'Подойдите ближе к лампе'
    case 'REVISION_CONFLICT':
      return 'Зал только что изменился, попробуйте ещё раз'
    case 'RATE_LIMITED':
      return rateLimitText(body.retry_after_ms)
  }
  return userErrorText(e)
}
