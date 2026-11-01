import type { SundayConfigLighting, SundayRoomConfig, SundayRoomRuntime } from '../network/sunday'
import { NPC_MAX } from '../npc/limits'

/** Черновик формы зала: числа — строками, как в полях ввода; углы гидов — в градусах. */
export type RoomDraft = {
  accent_color: string
  lighting: SundayConfigLighting
  npc_count: string
  installation_visible: boolean
  guides: Array<{ guide_id: string; x: string; z: string; rotation_deg: string }>
}

const COLOR_RE = /^#[0-9A-Fa-f]{6}$/

/** Угол в градусах с точностью до 0,1°, как его видит администратор. */
const shownDegrees = (rad: number): number => Math.round(((rad * 180) / Math.PI) * 10) / 10 + 0 // + 0: без «-0»

/** Строка поля → число; пустая строка и нечисла (`abc`, `Infinity`) дают null. */
function parseNumber(raw: string): number | null {
  if (raw.trim() === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/** Угол в радианах в полуинтервале [−π, π), как требует сервер. */
const wrapRadians = (rad: number): number => {
  const twoPi = 2 * Math.PI
  return ((((rad + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI
}

export function roomToDraft(rt: SundayRoomRuntime): RoomDraft {
  const c = rt.config
  return {
    accent_color: c.accent_color,
    lighting: c.lighting,
    npc_count: String(c.npc_count),
    installation_visible: c.installation_visible,
    guides: c.guide_placements.map((p) => ({
      guide_id: p.guide_id,
      x: String(p.position.x),
      z: String(p.position.z),
      rotation_deg: String(shownDegrees(p.rotation_y)),
    })),
  }
}

/** Ошибки по ключам `accent_color`, `npc_count`, `guide.<guide_id>.x|z|rotation_deg`; пусто — можно отправлять. */
export function validateRoomDraft(d: RoomDraft): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!COLOR_RE.test(d.accent_color)) errors.accent_color = 'Цвет в формате #RRGGBB'
  if (!/^\d+$/.test(d.npc_count) || Number(d.npc_count) > NPC_MAX) errors.npc_count = `Целое число от 0 до ${NPC_MAX}`
  for (const g of d.guides) {
    const key = `guide.${g.guide_id}`
    if (parseNumber(g.x) === null) errors[`${key}.x`] = 'Нужно число'
    if (parseNumber(g.z) === null) errors[`${key}.z`] = 'Нужно число'
    if (parseNumber(g.rotation_deg) === null) errors[`${key}.rotation_deg`] = 'Нужно число (градусы)'
  }
  return errors
}

/**
 * Тело `config` для PUT. Места лампы берутся из `base` без изменений; угол гида, который администратор не трогал,
 * тоже остаётся точным значением сервера, а не округлённым до десятых градуса.
 */
export function draftToConfig(d: RoomDraft, base: SundayRoomConfig): SundayRoomConfig {
  return {
    accent_color: d.accent_color,
    lighting: d.lighting,
    npc_count: Number(d.npc_count),
    installation_visible: d.installation_visible,
    lamp_slots: base.lamp_slots.map((s) => ({ slot_id: s.slot_id, position: { ...s.position } })),
    guide_placements: d.guides.map((g) => {
      const old = base.guide_placements.find((p) => p.guide_id === g.guide_id)
      const deg = Number(g.rotation_deg)
      const untouched = old !== undefined && deg === shownDegrees(old.rotation_y)
      return {
        guide_id: g.guide_id,
        position: { x: Number(g.x), y: 0, z: Number(g.z) },
        rotation_y: untouched ? old.rotation_y : wrapRadians((deg * Math.PI) / 180),
      }
    }),
  }
}
