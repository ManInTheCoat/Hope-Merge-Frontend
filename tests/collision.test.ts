import { expect, test } from 'bun:test'
import { moveCylinder, surfacesToColliders, type Aabb, type Bounds2 } from '../src/scene/collision'
import type { Surface } from '../src/network/contract'

const R = 0.3
const H = 1.8
const bounds: Bounds2 = { minX: -6, maxX: 6, minZ: -8, maxZ: 8 }
const wall: Aabb = { minX: 1.9, maxX: 2.1, minY: 0, maxY: 4, minZ: -8, maxZ: 8 }
const open = { colliders: [] as Aabb[], bounds }
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6)

test('свободное движение', () => {
  const p = moveCylinder({ x: 0, z: 0 }, { x: 1, z: 1 }, open, R, H)
  near(p.x, 1)
  near(p.z, 1)
})

test('упирается в стену', () => {
  const p = moveCylinder({ x: 0, z: 0 }, { x: 5, z: 0 }, { colliders: [wall], bounds }, R, H)
  near(p.x, 1.6)
  near(p.z, 0)
})

test('скользит вдоль стены', () => {
  const p = moveCylinder({ x: 0, z: 0 }, { x: 5, z: 2 }, { colliders: [wall], bounds }, R, H)
  near(p.x, 1.6)
  near(p.z, 2)
})

test('скачок dt не пробивает стену', () => {
  const p = moveCylinder({ x: 0, z: 0 }, { x: 50, z: 0 }, { colliders: [wall], bounds }, R, H)
  expect(p.x).toBeLessThanOrEqual(1.6 + 1e-6)
})

test('bounds ограничивают', () => {
  const p = moveCylinder({ x: 0, z: 0 }, { x: 0, z: 50 }, open, R, H)
  near(p.z, 7.7)
})

test('коллайдер выше головы игнорируется', () => {
  const high: Aabb = { ...wall, minY: 2 }
  const p = moveCylinder({ x: 0, z: 0 }, { x: 5, z: 0 }, { colliders: [high], bounds }, R, H)
  near(p.x, 5)
})

test('угол не проникает', () => {
  const wallX: Aabb = { minX: 1.9, maxX: 2.1, minY: 0, maxY: 4, minZ: -8, maxZ: 8 }
  const wallZ: Aabb = { minX: -6, maxX: 6, minY: 0, maxY: 4, minZ: 1.9, maxZ: 2.1 }
  const p = moveCylinder({ x: 0, z: 0 }, { x: 5, z: 5 }, { colliders: [wallX, wallZ], bounds }, R, H)
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
