import type { NpcPose } from './npcBuffer'

export const PASS_RANGE_M = 1
export const PASS_CONE_RAD = Math.PI / 3
export const PASS_SHOW_MS = 2500
export const PASS_COOLDOWN_MS = 6000

export const PASS_PHRASES: string[] = [
  'Простите, можно пройти?',
  'Извините, вы не пропустите?',
  'Позвольте пройти, пожалуйста.',
  'Не подвинетесь немного?',
  'Разрешите, я хочу рассмотреть картину.',
]

/** Номер NPC из `npc_07` → 7; для нестандартных ID — 0. */
const indexOf = (id: string): number => {
  const m = /(\d+)$/.exec(id)
  return m ? Number(m[1]) : 0
}

/**
 * Просьба освободить проход: NPC стоит (`idle`), игрок ближе 1 м и впереди него в пределах 60° от взгляда.
 * Реплика одна на всю сцену: показывается 2,5 с, новая — не раньше чем через 6 с после начала прошлой.
 */
export class PassRequest {
  private text: string | null = null
  private shownAt = -Infinity

  update(nowMs: number, player: { x: number; z: number } | null, npcs: NpcPose[]): string | null {
    if (this.text !== null) {
      if (nowMs - this.shownAt < PASS_SHOW_MS) return this.text
      this.text = null
    }
    if (!player || nowMs - this.shownAt < PASS_COOLDOWN_MS) return null
    let best: NpcPose | null = null
    let bestDist = Infinity
    for (const n of npcs) {
      if (n.state !== 'idle') continue
      const dx = player.x - n.x
      const dz = player.z - n.z
      const dist = Math.hypot(dx, dz)
      if (dist >= PASS_RANGE_M || dist >= bestDist) continue
      // Направление на игрока против взгляда NPC (−sin yaw, −cos yaw).
      const cos = dist === 0 ? 1 : (dx * -Math.sin(n.yaw) + dz * -Math.cos(n.yaw)) / dist
      if (Math.acos(Math.max(-1, Math.min(1, cos))) > PASS_CONE_RAD) continue
      best = n
      bestDist = dist
    }
    if (!best) return null
    this.text = PASS_PHRASES[indexOf(best.id) % PASS_PHRASES.length]
    this.shownAt = nowMs
    return this.text
  }
}
