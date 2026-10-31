import type { Room, Surface, Vec3 } from '../contract'

/*
 * Правила движения сервера (бэкенд, internal/domain/world/geometry.go: ValidPose и Sweep), перенесённые
 * дословно. Мок нарочно не использует клиентскую коллизию: иначе ошибки клиента на моке не видны.
 */

const R = 0.3
const H = 1.8

function blocks(room: Room): Surface[] {
  return room.surfaces.filter((b) => b.collidable && b.position.y + b.size.y / 2 > 0 && b.position.y - b.size.y / 2 < H)
}

const finite = (v: Vec3) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)

export function mockValidPose(room: Room, p: Vec3): boolean {
  if (!finite(p) || p.y !== 0) return false
  const { min, max } = room.bounds
  if (p.x - R < min.x || p.x + R > max.x || p.z - R < min.z || p.z + R > max.z || min.y > 0 || max.y < H) return false
  for (const b of blocks(room)) {
    const dx = Math.max(Math.abs(p.x - b.position.x) - b.size.x / 2, 0)
    const dz = Math.max(Math.abs(p.z - b.position.z) - b.size.z / 2, 0)
    if (dx * dx + dz * dz < R * R) return false
  }
  return true
}

/** Минимум квадрата расстояния от отрезка XZ до прямоугольника блока (кусочно-квадратичная функция). */
function segmentRectDistSq(from: Vec3, to: Vec3, b: Surface): number {
  const axes = [
    [from.x, to.x - from.x, b.position.x - b.size.x / 2, b.position.x + b.size.x / 2],
    [from.z, to.z - from.z, b.position.z - b.size.z / 2, b.position.z + b.size.z / 2],
  ]
  const cuts = [0, 1]
  for (const [p0, d, lo, hi] of axes) {
    if (d === 0) continue
    for (const bound of [lo, hi]) {
      const t = (bound - p0) / d
      if (t > 0 && t < 1) cuts.push(t)
    }
  }
  cuts.sort((a, b2) => a - b2)
  const distance = (t: number) =>
    axes.reduce((sum, [p0, d, lo, hi]) => {
      const p = p0 + t * d
      const e = Math.max(lo - p, p - hi, 0)
      return sum + e * e
    }, 0)
  let best = Math.min(distance(0), distance(1))
  for (let i = 1; i < cuts.length; i++) {
    const lo = cuts[i - 1]
    const hi = cuts[i]
    const mid = (lo + hi) / 2
    let aa = 0
    let ab = 0
    for (const [p0, d, min, max] of axes) {
      const p = p0 + mid * d
      if (p >= min && p <= max) continue
      const bound = p > max ? max : min
      aa += d * d
      ab += d * (p0 - bound)
    }
    best = Math.min(best, distance(lo))
    if (aa > 0) best = Math.min(best, distance(Math.max(lo, Math.min(hi, -ab / aa))))
  }
  return best
}

export function mockSweep(room: Room, from: Vec3, to: Vec3): boolean {
  if (!mockValidPose(room, from) || !mockValidPose(room, to)) return false
  return blocks(room).every((b) => segmentRectDistSq(from, to, b) >= R * R)
}

/** Скорость: не дальше 4·min(dt, 0,25) м с погрешностью 1e-6 (api.md §5). */
export function mockSpeedOk(from: Vec3, to: Vec3, dtS: number): boolean {
  return Math.hypot(to.x - from.x, to.z - from.z) <= 4 * Math.max(0, Math.min(dtS, 0.25)) + 1e-6
}
