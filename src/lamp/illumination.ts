/** Луч лампы: откуда, куда (единичный вектор) и светит ли она. */
export type Beam = { origin: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number }; on: boolean }

/** Картина: центр и поворот вокруг Y; лицевая сторона смотрит вдоль (sin ry, 0, cos ry), как у targeting. */
export type PaintingSpot = { position: { x: number; y: number; z: number }; rotation_y: number }

/** Половина угла луча (api-sunday.md §2): внутри половины от неё картина освещена полностью, к краю — плавно слабее. */
const CONE_HALF_ANGLE = Math.PI / 6
/** Расстояние, на котором подсветка начинает слабеть, и предел луча (distance=8). */
const FULL_RANGE_M = 4
const MAX_RANGE_M = 8
/** Лампа должна быть перед картиной, а не за стеной или сбоку почти вплотную. */
const MIN_FRONT_DOT = 0.15

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Насколько луч освещает картину: 0 — совсем нет, 1 — в упор. Считается по центру картины. */
export function paintingLight(beam: Beam, p: PaintingSpot): number {
  if (!beam.on) return 0
  const vx = p.position.x - beam.origin.x
  const vy = p.position.y - beam.origin.y
  const vz = p.position.z - beam.origin.z
  const dist = Math.hypot(vx, vy, vz)
  if (dist < 0.05 || dist > MAX_RANGE_M) return 0

  // Лампа с лицевой стороны картины и свет падает не вскользь.
  const nx = Math.sin(p.rotation_y)
  const nz = Math.cos(p.rotation_y)
  const front = (-vx * nx - vz * nz) / dist // от картины к лампе вдоль нормали
  if (front < MIN_FRONT_DOT) return 0
  const incidence = smoothstep(0.1, 0.5, -(beam.dir.x * nx + beam.dir.z * nz))
  if (incidence === 0) return 0

  const cos = (vx * beam.dir.x + vy * beam.dir.y + vz * beam.dir.z) / dist
  const angle = Math.acos(Math.min(1, Math.max(-1, cos)))
  const cone = 1 - smoothstep(CONE_HALF_ANGLE * 0.5, CONE_HALF_ANGLE, angle)
  const range = 1 - smoothstep(FULL_RANGE_M, MAX_RANGE_M, dist)
  return cone * range * incidence
}
