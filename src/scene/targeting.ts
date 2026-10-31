import type { Exhibit, Vec3 } from '../network/contract'
import type { Aabb, Vec2 } from './collision'

/** Подсказку «E» показываем с запасом: сервер проверяет ≤ 3 м по своей, чуть отстающей позиции. */
export const HINT_RADIUS_M = 2.8

/** Пересекает ли отрезок a→b внутренность бокса (метод плит). Касание концами не считается. */
export function segmentHitsBox(a: Vec3, b: Vec3, box: Aabb): boolean {
  let t0 = 0
  let t1 = 1
  const axes: Array<[number, number, number, number]> = [
    [a.x, b.x - a.x, box.minX, box.maxX],
    [a.y, b.y - a.y, box.minY, box.maxY],
    [a.z, b.z - a.z, box.minZ, box.maxZ],
  ]
  for (const [p, d, min, max] of axes) {
    if (Math.abs(d) < 1e-12) {
      if (p <= min || p >= max) return false
      continue
    }
    let ta = (min - p) / d
    let tb = (max - p) / d
    if (ta > tb) [ta, tb] = [tb, ta]
    t0 = Math.max(t0, ta)
    t1 = Math.min(t1, tb)
    if (t0 >= t1) return false
  }
  return true
}

/**
 * Картина, на которую смотрит игрок. Сервер (api.md, «Осмотр») требует XZ ≤ 3 м и отсутствие стены
 * между камерой и центром экспоната; `colliders` — стены зала для этой проверки.
 */
export function pickExhibit(
  input: { eye: Vec3; dir: Vec3; playerXZ: Vec2; colliders?: Aabb[] },
  exhibits: Exhibit[],
  hintRadiusM: number = HINT_RADIUS_M,
): Exhibit | null {
  const { eye, dir, playerXZ } = input
  let best: Exhibit | null = null
  let bestT = Infinity

  for (const e of exhibits) {
    if (Math.hypot(e.position.x - playerXZ.x, e.position.z - playerXZ.z) > hintRadiusM) continue

    const nx = Math.sin(e.rotation_y)
    const nz = Math.cos(e.rotation_y)
    const denom = dir.x * nx + dir.z * nz
    if (denom >= 0) continue // луч идёт не против нормали: лицевая сторона не видна

    const t = ((e.position.x - eye.x) * nx + (e.position.z - eye.z) * nz) / denom
    if (t <= 0 || t >= bestT) continue

    const hx = eye.x + dir.x * t - e.position.x
    const hy = eye.y + dir.y * t - e.position.y
    const hz = eye.z + dir.z * t - e.position.z
    const local = hx * Math.cos(e.rotation_y) - hz * Math.sin(e.rotation_y)
    if (Math.abs(local) > e.width_m / 2 || Math.abs(hy) > e.height_m / 2) continue
    if (input.colliders?.some((box) => segmentHitsBox(eye, e.position, box))) continue

    best = e
    bestT = t
  }
  return best
}
