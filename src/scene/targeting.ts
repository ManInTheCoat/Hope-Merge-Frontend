import type { Exhibit, Vec3 } from '../network/contract'
import type { Vec2 } from './collision'

/** Подсказку «E» показываем с запасом: сервер проверяет ≤ 3 м по своей, чуть отстающей позиции. */
export const HINT_RADIUS_M = 2.8

export function pickExhibit(
  input: { eye: Vec3; dir: Vec3; playerXZ: Vec2 },
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

    best = e
    bestT = t
  }
  return best
}
