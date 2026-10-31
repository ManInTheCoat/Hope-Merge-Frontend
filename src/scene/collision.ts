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

function pushOut(p: Vec2, box: Aabb, radius: number): void {
  const cx = Math.min(Math.max(p.x, box.minX), box.maxX)
  const cz = Math.min(Math.max(p.z, box.minZ), box.maxZ)
  const dx = p.x - cx
  const dz = p.z - cz
  const dist = Math.hypot(dx, dz)
  if (dist >= radius) return
  if (dist > 0) {
    const k = (radius - dist) / dist
    p.x += dx * k
    p.z += dz * k
    return
  }
  // Центр внутри прямоугольника: выталкиваем по ближайшей грани.
  const options = [
    { d: p.x - box.minX, ax: 'x' as const, s: -1, edge: box.minX },
    { d: box.maxX - p.x, ax: 'x' as const, s: 1, edge: box.maxX },
    { d: p.z - box.minZ, ax: 'z' as const, s: -1, edge: box.minZ },
    { d: box.maxZ - p.z, ax: 'z' as const, s: 1, edge: box.maxZ },
  ]
  const best = options.reduce((a, b) => (b.d < a.d ? b : a))
  p[best.ax] = best.edge + best.s * radius
}

export function moveCylinder(
  from: Vec2,
  delta: Vec2,
  world: { colliders: Aabb[]; bounds: Bounds2 },
  radius: number,
  height: number,
): Vec2 {
  const active = world.colliders.filter((c) => c.maxY > 0 && c.minY < height)
  const { bounds } = world
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(delta.x), Math.abs(delta.z)) / (radius / 2)))
  const p: Vec2 = { x: from.x, z: from.z }
  const clamp = () => {
    p.x = Math.min(Math.max(p.x, bounds.minX + radius), bounds.maxX - radius)
    p.z = Math.min(Math.max(p.z, bounds.minZ + radius), bounds.maxZ - radius)
  }
  for (let i = 0; i < steps; i++) {
    p.x += delta.x / steps
    for (const box of active) pushOut(p, box, radius)
    clamp()
    p.z += delta.z / steps
    for (const box of active) pushOut(p, box, radius)
    clamp()
  }
  return p
}
