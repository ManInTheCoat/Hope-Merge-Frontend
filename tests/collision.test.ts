import { expect, test } from 'bun:test'
import {
  activeColliders,
  COLLISION_EPS_M,
  moveCylinder,
  segmentClear,
  surfacesToColliders,
  validPose,
  type Aabb,
  type Bounds2,
} from '../src/scene/collision'
import type { Surface } from '../src/network/contract'

const R = 0.3
const H = 1.8
const bounds: Bounds2 = { minX: -6, maxX: 6, minZ: -8, maxZ: 8 }
const wall: Aabb = { minX: 1.9, maxX: 2.1, minY: 0, maxY: 4, minZ: -8, maxZ: 8 }
const open = { colliders: [] as Aabb[], bounds }
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6)

test('свободное движение', () => {
  const p = moveCylinder({ x: 0, z: 0 }, { x: 1, z: 1 }, open, R)
  near(p.x, 1)
  near(p.z, 1)
})

test('упирается в стену с зазором 1 мм', () => {
  const world = { colliders: [wall], bounds }
  const p = moveCylinder({ x: 0, z: 0 }, { x: 5, z: 0 }, world, R)
  near(p.x, 1.6 - COLLISION_EPS_M)
  expect(validPose(p, world, R)).toBe(true)
  near(p.z, 0)
})

test('скользит вдоль стены', () => {
  const p = moveCylinder({ x: 0, z: 0 }, { x: 5, z: 2 }, { colliders: [wall], bounds }, R)
  near(p.x, 1.6 - COLLISION_EPS_M)
  near(p.z, 2)
})

test('скачок dt не пробивает стену', () => {
  const p = moveCylinder({ x: 0, z: 0 }, { x: 50, z: 0 }, { colliders: [wall], bounds }, R)
  expect(p.x).toBeLessThanOrEqual(1.6 + 1e-6)
})

test('bounds ограничивают', () => {
  const p = moveCylinder({ x: 0, z: 0 }, { x: 0, z: 50 }, open, R)
  near(p.z, 7.7 - COLLISION_EPS_M)
})

test('коллайдер выше головы игнорируется', () => {
  const high: Aabb = { ...wall, minY: 2 }
  const p = moveCylinder({ x: 0, z: 0 }, { x: 5, z: 0 }, { colliders: activeColliders([high], H), bounds }, R)
  near(p.x, 5)
})

test('угол не проникает', () => {
  const wallX: Aabb = { minX: 1.9, maxX: 2.1, minY: 0, maxY: 4, minZ: -8, maxZ: 8 }
  const wallZ: Aabb = { minX: -6, maxX: 6, minY: 0, maxY: 4, minZ: 1.9, maxZ: 2.1 }
  const p = moveCylinder({ x: 0, z: 0 }, { x: 5, z: 5 }, { colliders: [wallX, wallZ], bounds }, R)
  expect(1.9 - p.x).toBeGreaterThanOrEqual(R - 1e-6)
  expect(1.9 - p.z).toBeGreaterThanOrEqual(R - 1e-6)
})

test('surfacesToColliders пропускает не-collidable', () => {
  const s = (id: string, collidable: boolean, pos = { x: 0, y: 2, z: -8.1 }): Surface => ({
    id,
    position: pos,
    size: { x: 12.4, y: 4, z: 0.2 },
    color: '#fff',
    collidable,
  })
  const boxes = surfacesToColliders([s('a', true), s('b', false), s('c', true)])
  expect(boxes.length).toBe(2)
  near(boxes[0].minZ, -8.2)
  near(boxes[0].maxZ, -8.0)
  near(boxes[0].minY, 0)
  near(boxes[0].maxY, 4)
})

const box01: Aabb = { minX: 0, maxX: 1, minY: 0, maxY: 3, minZ: 0, maxZ: 1 }
const wide: Bounds2 = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }

test('validPose: ровно 0,3 м от блока допустимо, ближе — нет (как на сервере)', () => {
  const world = { colliders: [box01], bounds: wide }
  expect(validPose({ x: -0.3, z: 0.5 }, world, R)).toBe(true)
  expect(validPose({ x: -0.29, z: 0.5 }, world, R)).toBe(false)
  expect(validPose({ x: 9.7, z: 0 }, world, R)).toBe(true)
  expect(validPose({ x: 9.71, z: 0 }, world, R)).toBe(false)
})

test('segmentClear: отрезок, срезающий угол блока, отклоняется', () => {
  const world = { colliders: [box01], bounds: wide }
  expect(segmentClear({ x: -0.5, z: 0.25 }, { x: 0.25, z: -0.5 }, world, R)).toBe(false)
  expect(segmentClear({ x: -0.7, z: 0.25 }, { x: 0.25, z: -0.7 }, world, R)).toBe(true)
})

test('узкая щель между границей и колонной не оставляет игрока внутри колонны', () => {
  const b: Bounds2 = { minX: 0, maxX: 10, minZ: -10, maxZ: 10 }
  const column: Aabb = { minX: 0.5, maxX: 1, minY: 0, maxY: 3, minZ: 0, maxZ: 1 }
  const world = { colliders: [column], bounds: b }
  const p = moveCylinder({ x: 0.3, z: -1 }, { x: 0, z: 2 }, world, R)
  expect(validPose(p, world, R)).toBe(true)
})

test('проход между двумя блоками: результат всегда допустим', () => {
  const a: Aabb = { minX: 0, maxX: 1, minY: 0, maxY: 3, minZ: 0, maxZ: 10 }
  const c: Aabb = { minX: 1.65, maxX: 2.65, minY: 0, maxY: 3, minZ: 0, maxZ: 10 }
  const world = { colliders: [a, c], bounds: wide }
  for (const dx of [-0.5, -0.2, 0, 0.2, 0.5]) {
    const p = moveCylinder({ x: 1.325, z: -1 }, { x: dx, z: 3 }, world, R)
    expect(validPose(p, world, R)).toBe(true)
  }
})
