import type { Door, Exhibit, Guide, Vec3 } from '../network/contract'
import type { Aabb, Vec2 } from './collision'

/** Подсказку «E» показываем с запасом: сервер проверяет ≤ 3 м по своей, чуть отстающей позиции. */
export const HINT_RADIUS_M = 2.8
/** Подсказка двери: сервер пускает до 1,5 м по XZ, но видит позицию с задержкой — берём запас. */
export const DOOR_HINT_RADIUS_M = 1.3

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

type LookInput = { eye: Vec3; dir: Vec3; playerXZ: Vec2; colliders?: Aabb[] }

/** Радиус и высота цилиндра, в который должен попасть взгляд, чтобы выбрать гида. */
export const GUIDE_HIT_RADIUS_M = 0.4
export const GUIDE_HIT_HEIGHT_M = 1.8
/** Сервер проверяет видимость точки на этой высоте над позицией гида (api.md §7). */
export const GUIDE_EYE_HEIGHT_M = 1.65

export type Target = { kind: 'exhibit'; exhibit: Exhibit } | { kind: 'guide'; guide: Guide } | null

/** Расстояние по лучу до картины или null, если взгляд в неё не попадает. */
function exhibitHitT(input: LookInput, e: Exhibit, hintRadiusM: number): number | null {
  const { eye, dir, playerXZ } = input
  if (Math.hypot(e.position.x - playerXZ.x, e.position.z - playerXZ.z) > hintRadiusM) return null

  const nx = Math.sin(e.rotation_y)
  const nz = Math.cos(e.rotation_y)
  const denom = dir.x * nx + dir.z * nz
  if (denom >= 0) return null // луч идёт не против нормали: лицевая сторона не видна

  const t = ((e.position.x - eye.x) * nx + (e.position.z - eye.z) * nz) / denom
  if (t <= 0) return null

  const hx = eye.x + dir.x * t - e.position.x
  const hy = eye.y + dir.y * t - e.position.y
  const hz = eye.z + dir.z * t - e.position.z
  const local = hx * Math.cos(e.rotation_y) - hz * Math.sin(e.rotation_y)
  if (Math.abs(local) > e.width_m / 2 || Math.abs(hy) > e.height_m / 2) return null
  if (input.colliders?.some((box) => segmentHitsBox(eye, e.position, box))) return null
  return t
}

/** Расстояние по лучу до входа в цилиндр гида или null (дальше радиуса, мимо, за стеной). */
function guideHitT(input: LookInput, g: Guide, hintRadiusM: number): number | null {
  const { eye, dir, playerXZ } = input
  if (Math.hypot(g.position.x - playerXZ.x, g.position.z - playerXZ.z) > hintRadiusM) return null

  // |(eye + dir·t − p)_xz|² = r²
  const ox = eye.x - g.position.x
  const oz = eye.z - g.position.z
  const a = dir.x * dir.x + dir.z * dir.z
  if (a === 0) return null
  const b = 2 * (ox * dir.x + oz * dir.z)
  const c = ox * ox + oz * oz - GUIDE_HIT_RADIUS_M * GUIDE_HIT_RADIUS_M
  const disc = b * b - 4 * a * c
  if (disc < 0) return null
  const sq = Math.sqrt(disc)
  const t1 = (-b - sq) / (2 * a)
  const t = t1 > 0 ? t1 : (-b + sq) / (2 * a)
  if (t <= 0) return null

  const y = eye.y + dir.y * t
  if (y < g.position.y || y > g.position.y + GUIDE_HIT_HEIGHT_M) return null
  const head = { x: g.position.x, y: g.position.y + GUIDE_EYE_HEIGHT_M, z: g.position.z }
  if (input.colliders?.some((box) => segmentHitsBox(eye, head, box))) return null
  return t
}

/**
 * Картина, на которую смотрит игрок. Сервер (api.md, «Осмотр») требует XZ ≤ 3 м и отсутствие стены
 * между камерой и центром экспоната; `colliders` — стены зала для этой проверки.
 */
export function pickExhibit(input: LookInput, exhibits: Exhibit[], hintRadiusM: number = HINT_RADIUS_M): Exhibit | null {
  const t = pickTarget(input, exhibits, [], hintRadiusM)
  return t?.kind === 'exhibit' ? t.exhibit : null
}

/** Картина или гид под взглядом; при попадании в обоих выигрывает ближний по лучу. */
export function pickTarget(input: LookInput, exhibits: Exhibit[], guides: Guide[], hintRadiusM: number = HINT_RADIUS_M): Target {
  let best: Target = null
  let bestT = Infinity
  for (const exhibit of exhibits) {
    const t = exhibitHitT(input, exhibit, hintRadiusM)
    if (t !== null && t < bestT) {
      best = { kind: 'exhibit', exhibit }
      bestT = t
    }
  }
  for (const guide of guides) {
    const t = guideHitT(input, guide, hintRadiusM)
    if (t !== null && t < bestT) {
      best = { kind: 'guide', guide }
      bestT = t
    }
  }
  return best
}

/** Ближайшая дверь в радиусе подсказки по XZ от `door.position` (там же меряет сервер). */
export function pickDoor(playerXZ: Vec2, doors: Door[], radiusM: number = DOOR_HINT_RADIUS_M): Door | null {
  let best: Door | null = null
  let bestD = Infinity
  for (const d of doors) {
    const dist = Math.hypot(d.position.x - playerXZ.x, d.position.z - playerXZ.z)
    if (dist <= radiusM && dist < bestD) {
      best = d
      bestD = dist
    }
  }
  return best
}
