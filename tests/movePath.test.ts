import { expect, test } from 'bun:test'
import { segmentClear, type Aabb, type MoveWorld } from '../src/scene/collision'
import { MovePath } from '../src/world/movePath'

const R = 0.3
const box: Aabb = { minX: 0, maxX: 1, minY: 0, maxY: 3, minZ: 0, maxZ: 1 }
const open: MoveWorld = { colliders: [], bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 } }
const withBox: MoveWorld = { colliders: [box], bounds: open.bounds }
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z)

test('прямой путь без препятствий: отправляется конечная точка', () => {
  const path = new MovePath()
  path.reset({ x: 0, z: 0 })
  for (let i = 1; i <= 6; i++) path.record({ x: 0, z: -0.06 * i })
  const p = path.take(open, R, 0.36)!
  expect(p.z).toBeCloseTo(-0.36, 9)
  expect(path.pending).toBe(false)
})

test('обход угла по дуге: сначала промежуточная точка с чистым отрезком, затем конечная', () => {
  const path = new MovePath()
  const start = { x: -0.31, z: 0.5 }
  path.reset(start)
  // Дуга радиусом 0,31 вокруг угла (0,0): от левой грани к нижней.
  const arc = Array.from({ length: 10 }, (_, i) => {
    const a = Math.PI - ((i + 1) / 10) * (Math.PI / 2)
    return { x: 0.31 * Math.cos(a), z: -0.31 * Math.sin(a) }
  })
  const pts = [{ x: -0.31, z: 0 }, ...arc]
  pts.forEach((p) => path.record(p))
  const end = pts[pts.length - 1]
  expect(segmentClear(start, end, withBox, R)).toBe(false) // прямая срезала бы угол

  const first = path.take(withBox, R, 10)!
  expect(dist(first, end)).toBeGreaterThan(1e-6)
  expect(segmentClear(start, first, withBox, R)).toBe(true)
  expect(path.pending).toBe(true)

  let last = first
  let guard = 0
  while (path.pending && guard++ < 20) {
    const next = path.take(withBox, R, 10)!
    expect(segmentClear(last, next, withBox, R)).toBe(true)
    last = next
  }
  expect(dist(last, end)).toBeLessThan(1e-9)
})

test('шаг длиннее разрешённого дробится: каждая отправка не дальше maxStep', () => {
  const path = new MovePath()
  path.reset({ x: 0, z: 0 })
  path.record({ x: 0, z: -1 }) // вкладка была в фоне: один прыжок на метр
  let last = { x: 0, z: 0 }
  let guard = 0
  while (path.pending && guard++ < 10) {
    const p = path.take(open, R, 0.36)!
    expect(dist(last, p)).toBeLessThanOrEqual(0.36 + 1e-9)
    last = p
  }
  expect(last.z).toBeCloseTo(-1, 9)
})

test('без движения отправлять нечего', () => {
  const path = new MovePath()
  path.reset({ x: 1, z: 1 })
  path.record({ x: 1, z: 1 })
  expect(path.take(open, R, 0.36)).toBeNull()
  expect(path.pending).toBe(false)
})
