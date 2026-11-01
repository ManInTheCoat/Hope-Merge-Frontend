import type { Door, Exhibit, Guide, Vec3 } from '../network/contract'
import type { Aabb, Vec2 } from './collision'

/** Подсказку «E» показываем с запасом: сервер проверяет ≤ 3 м по своей, чуть отстающей позиции. */
const HINT_RADIUS_M = 2.8
/** Подсказка двери: сервер пускает до 1,5 м по XZ, но видит позицию с задержкой — берём запас. */
const DOOR_HINT_RADIUS_M = 1.3

/** Пересекает ли отрезок a→b внутренность бокса (метод плит). Касание концами не считается. */
function segmentHitsBox(a: Vec3, b: Vec3, box: Aabb): boolean {
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

/** `rangeFrom` — позиция, которую знает сервер: от неё он меряет радиус взаимодействия. По умолчанию — камера. */
export type LookInput = { eye: Vec3; dir: Vec3; colliders?: Aabb[]; rangeFrom?: Vec2 }

/** Радиус и высота цилиндра, в который должен попасть взгляд, чтобы выбрать гида. */
const GUIDE_HIT_RADIUS_M = 0.4
const GUIDE_HIT_HEIGHT_M = 1.8
/** Сервер проверяет видимость точки на этой высоте над позицией гида (api.md §7). */
const GUIDE_EYE_HEIGHT_M = 1.65

export type Target = { kind: 'exhibit'; exhibit: Exhibit } | { kind: 'guide'; guide: Guide } | null

/** Расстояние по лучу до картины или null, если взгляд в неё не попадает. */
function exhibitHitT(input: LookInput, e: Exhibit, hintRadiusM: number): number | null {
  const { eye, dir } = input
  const from = input.rangeFrom ?? eye
  if (Math.hypot(e.position.x - from.x, e.position.z - from.z) > hintRadiusM) return null

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

/**
 * Расстояние по лучу до входа в вертикальный цилиндр с основанием в `pos` или null (дальше радиуса, мимо, за стеной).
 * Видимость проверяется отрезком от глаз до точки на высоте `losY` над основанием.
 */
export function cylinderHitT(
  input: LookInput,
  pos: Vec3,
  radiusM: number,
  heightM: number,
  losY: number,
  hintRadiusM: number,
): number | null {
  const { eye, dir } = input
  const from = input.rangeFrom ?? eye
  if (Math.hypot(pos.x - from.x, pos.z - from.z) > hintRadiusM) return null

  // |(eye + dir·t − p)_xz|² = r²
  const ox = eye.x - pos.x
  const oz = eye.z - pos.z
  const a = dir.x * dir.x + dir.z * dir.z
  if (a === 0) return null
  const b = 2 * (ox * dir.x + oz * dir.z)
  const c = ox * ox + oz * oz - radiusM * radiusM
  const disc = b * b - 4 * a * c
  if (disc < 0) return null
  const sq = Math.sqrt(disc)
  const t1 = (-b - sq) / (2 * a)
  const t = t1 > 0 ? t1 : (-b + sq) / (2 * a)
  if (t <= 0) return null

  const y = eye.y + dir.y * t
  if (y < pos.y || y > pos.y + heightM) return null
  const point = { x: pos.x, y: pos.y + losY, z: pos.z }
  if (input.colliders?.some((box) => segmentHitsBox(eye, point, box))) return null
  return t
}

/** Отрезок от глаз до точки не проходит сквозь блок. */
export function sightClear(input: LookInput, point: Vec3): boolean {
  return !input.colliders?.some((box) => segmentHitsBox(input.eye, point, box))
}

const guideHitT = (input: LookInput, g: Guide, hintRadiusM: number) =>
  cylinderHitT(input, g.position, GUIDE_HIT_RADIUS_M, GUIDE_HIT_HEIGHT_M, GUIDE_EYE_HEIGHT_M, hintRadiusM)

/** Картина или гид под взглядом и расстояние до него по лучу; при попадании в обоих выигрывает ближний. */
export function pickTargetT(
  input: LookInput,
  exhibits: Exhibit[],
  guides: Guide[],
  hintRadiusM: number = HINT_RADIUS_M,
): { target: Target; t: number } {
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
  return { target: best, t: bestT }
}

/** Картина или гид под взглядом; при попадании в обоих выигрывает ближний по лучу. */
export const pickTarget = (input: LookInput, exhibits: Exhibit[], guides: Guide[], hintRadiusM: number = HINT_RADIUS_M): Target =>
  pickTargetT(input, exhibits, guides, hintRadiusM).target

/** Высота глаз над позицией игрока (api.md §1): от неё сервер проверяет видимость двери. */
const EYE_HEIGHT_M = 1.65

/**
 * Ближайшая дверь в радиусе подсказки по XZ от `door.position` (там же меряет сервер), если отрезок
 * от глаз до точки двери не проходит сквозь блок: иначе сервер откажет в переходе.
 */
export function pickDoor(playerXZ: Vec2, doors: Door[], colliders: Aabb[] = [], radiusM: number = DOOR_HINT_RADIUS_M): Door | null {
  let best: Door | null = null
  let bestD = Infinity
  const eye = { x: playerXZ.x, y: EYE_HEIGHT_M, z: playerXZ.z }
  for (const d of doors) {
    const dist = Math.hypot(d.position.x - playerXZ.x, d.position.z - playerXZ.z)
    if (dist > radiusM || dist >= bestD) continue
    if (colliders.some((box) => segmentHitsBox(eye, d.position, box))) continue
    best = d
    bestD = dist
  }
  return best
}
