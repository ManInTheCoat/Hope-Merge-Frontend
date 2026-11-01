import { wrapAngle } from '../scene/angles'
import type { NpcPose } from './npcBuffer'

/** Скорость, при которой качание конечностей максимально: стандартная скорость NPC (api-sunday.md §5). */
export const FULL_SWING_SPEED_MPS = 0.6
const ARM_AMPLITUDE_RAD = 0.5
const LEG_AMPLITUDE_RAD = 0.6
const HEAD_LIMIT_RAD = Math.PI / 2

/** Качание рук и ног по накопленной фазе шага: стоящий NPC не качается, руки и ноги — в противофазе. */
export function limbSwing(phaseAccum: number, speedMps: number): { arm: number; leg: number } {
  const k = Math.min(1, Math.max(0, speedMps / FULL_SWING_SPEED_MPS))
  if (k === 0) return { arm: 0, leg: 0 }
  const s = Math.sin(phaseAccum)
  return { arm: ARM_AMPLITUDE_RAD * k * s, leg: -LEG_AMPLITUDE_RAD * k * s }
}

/**
 * Поворот головы относительно тела: в `talking` голова смотрит на цель (взгляд при yaw = 0 — вдоль −Z,
 * то есть вперёд (−sin yaw, −cos yaw)), не дальше ±π/2. Иначе 0.
 */
export function headYaw(
  npcYaw: number,
  state: NpcPose['state'],
  target: { x: number; z: number } | null,
  npc: { x: number; z: number },
): number {
  if (state !== 'talking' || !target) return 0
  const dx = target.x - npc.x
  const dz = target.z - npc.z
  if (dx === 0 && dz === 0) return 0
  const rel = wrapAngle(Math.atan2(-dx, -dz) - npcYaw)
  return Math.max(-HEAD_LIMIT_RAD, Math.min(HEAD_LIMIT_RAD, rel))
}
