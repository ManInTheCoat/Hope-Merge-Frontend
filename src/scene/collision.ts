import type { Surface } from '../network/contract'

export type Vec2 = { x: number; z: number }
export type Aabb = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }
export type Bounds2 = { minX: number; maxX: number; minZ: number; maxZ: number }

export function surfacesToColliders(surfaces: Surface[]): Aabb[] {
  return surfaces
    .filter((s) => s.collidable)
    .map((s) => ({
      minX: s.position.x - s.size.x / 2,
      maxX: s.position.x + s.size.x / 2,
      minY: s.position.y - s.size.y / 2,
      maxY: s.position.y + s.size.y / 2,
      minZ: s.position.z - s.size.z / 2,
      maxZ: s.position.z + s.size.z / 2,
    }))
}

/** Клиент держится чуть дальше серверного предела 0,3 м: float не должен давать отказ на границе. */
export const COLLISION_EPS_M = 0.001

/** Коллайдеры, которые задевает цилиндр игрока (как на сервере: блок целиком выше или ниже пропускается). */
export type MoveWorld = { colliders: Aabb[]; bounds: Bounds2 }

export function activeColliders(colliders: Aabb[], height: number): Aabb[] {
  return colliders.filter((c) => c.maxY > 0 && c.minY < height)
}

/** Ближайшая к точке точка прямоугольника блока в плоскости XZ. */
export function closestOnBox(p: Vec2, box: Aabb): Vec2 {
  return { x: Math.min(Math.max(p.x, box.minX), box.maxX), z: Math.min(Math.max(p.z, box.minZ), box.maxZ) }
}

function distSqToBox(p: Vec2, box: Aabb): number {
  const dx = Math.max(box.minX - p.x, p.x - box.maxX, 0)
  const dz = Math.max(box.minZ - p.z, p.z - box.maxZ, 0)
  return dx * dx + dz * dz
}

/** Серверный ValidPose в XZ: границы нестрого, до блоков не ближе radius (строго меньше — отказ). */
export function validPose(p: Vec2, world: MoveWorld, radius: number): boolean {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return false
  const b = world.bounds
  if (p.x - radius < b.minX || p.x + radius > b.maxX || p.z - radius < b.minZ || p.z + radius > b.maxZ) return false
  return world.colliders.every((box) => distSqToBox(p, box) >= radius * radius)
}

/** Минимум квадрата расстояния от отрезка до прямоугольника блока: перенос серверного segmentRectangleDistanceSquared. */
function segmentDistSqToBox(from: Vec2, to: Vec2, box: Aabb): number {
  const axes = [
    [from.x, to.x - from.x, box.minX, box.maxX],
    [from.z, to.z - from.z, box.minZ, box.maxZ],
  ]
  const cuts = [0, 1]
  for (const [p0, d, lo, hi] of axes) {
    if (d === 0) continue
    for (const bound of [lo, hi]) {
      const t = (bound - p0) / d
      if (t > 0 && t < 1) cuts.push(t)
    }
  }
  cuts.sort((a, b) => a - b)
  const distance = (t: number) => {
    let sum = 0
    for (const [p0, d, lo, hi] of axes) {
      const p = p0 + t * d
      const e = Math.max(lo - p, p - hi, 0)
      sum += e * e
    }
    return sum
  }
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

/** Серверный Sweep: обе позиции допустимы и весь прямой путь цилиндра не ближе radius к блокам. */
export function segmentClear(from: Vec2, to: Vec2, world: MoveWorld, radius: number): boolean {
  if (!validPose(from, world, radius) || !validPose(to, world, radius)) return false
  return world.colliders.every((box) => segmentDistSqToBox(from, to, box) >= radius * radius)
}

function pushOut(p: Vec2, box: Aabb, radius: number): void {
  const r = radius + COLLISION_EPS_M
  const c = closestOnBox(p, box)
  const dx = p.x - c.x
  const dz = p.z - c.z
  const dist = Math.hypot(dx, dz)
  if (dist >= r) return
  if (dist > 0) {
    const k = (r - dist) / dist
    p.x += dx * k
    p.z += dz * k
    return
  }
  // Центр внутри прямоугольника: выталкиваем по ближайшей грани.
  const toMinX = p.x - box.minX
  const toMaxX = box.maxX - p.x
  const toMinZ = p.z - box.minZ
  const toMaxZ = box.maxZ - p.z
  const m = Math.min(toMinX, toMaxX, toMinZ, toMaxZ)
  if (m === toMinX) p.x = box.minX - r
  else if (m === toMaxX) p.x = box.maxX + r
  else if (m === toMinZ) p.z = box.minZ - r
  else p.z = box.maxZ + r
}

const RESOLVE_PASSES = 4

/** Выталкивание и границы до устойчивости; false — допустимой позиции рядом нет. */
function resolve(p: Vec2, world: MoveWorld, radius: number): boolean {
  const b = world.bounds
  const r = radius + COLLISION_EPS_M
  for (let pass = 0; pass < RESOLVE_PASSES; pass++) {
    for (const box of world.colliders) pushOut(p, box, radius)
    p.x = Math.min(Math.max(p.x, b.minX + r), b.maxX - r)
    p.z = Math.min(Math.max(p.z, b.minZ + r), b.maxZ - r)
    if (validPose(p, world, radius)) return true
  }
  return false
}

/**
 * Шаг цилиндра с подшагами не длиннее radius/2: по X, затем по Z, со скольжением вдоль стен.
 * Подшаг, после которого позиция недопустима (узкая щель), не выполняется. `world.colliders` — уже `activeColliders`.
 */
export function moveCylinder(from: Vec2, delta: Vec2, world: MoveWorld, radius: number): Vec2 {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(delta.x), Math.abs(delta.z)) / (radius / 2)))
  const p: Vec2 = { x: from.x, z: from.z }
  for (let i = 0; i < steps; i++) {
    for (const axis of ['x', 'z'] as const) {
      const before = { x: p.x, z: p.z }
      p[axis] += delta[axis] / steps
      if (!resolve(p, world, radius)) {
        p.x = before.x
        p.z = before.z
      }
    }
  }
  return p
}
