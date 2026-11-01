import { expect, test } from 'bun:test'
import { paintingLight, type Beam } from '../src/lamp/illumination'

// Картина на северной стене: центр (0, 1.8, -8), лицом в +Z (rotation_y = 0).
const painting = { position: { x: 0, y: 1.8, z: -8 }, rotation_y: 0 }
const at = (x: number, z: number, aimX: number, aimY: number, aimZ: number, on = true): Beam => {
  const origin = { x, y: 1.1, z }
  const len = Math.hypot(aimX - x, aimY - 1.1, aimZ - z)
  return { origin, dir: { x: (aimX - x) / len, y: (aimY - 1.1) / len, z: (aimZ - z) / len }, on }
}

test('луч в центр картины с 3 м освещает её полностью', () => {
  expect(paintingLight(at(0, -5, 0, 1.8, -8), painting)).toBeCloseTo(1, 1)
})

test('мимо конуса, назад, выключенная и дальше 8 м — без подсветки', () => {
  expect(paintingLight(at(0, -5, 4, 1.8, -8), painting)).toBe(0) // в сторону на ~50°
  expect(paintingLight(at(0, -5, 0, 1.1, 0), painting)).toBe(0) // светит от картины
  expect(paintingLight(at(0, -5, 0, 1.8, -8, false), painting)).toBe(0)
  expect(paintingLight(at(0, 3, 0, 1.8, -8), painting)).toBe(0) // 11 м
})

test('к краю конуса и к пределу дальности подсветка плавно слабеет', () => {
  const centre = paintingLight(at(0, -5, 0, 1.8, -8), painting)
  const edge = paintingLight(at(0, -5, 1.4, 1.8, -8), painting) // ~25° от оси
  expect(edge).toBeGreaterThan(0)
  expect(edge).toBeLessThan(centre)
  const near = paintingLight(at(0, -4, 0, 1.8, -8), painting) // 4 м
  const far = paintingLight(at(0, -1.5, 0, 1.8, -8), painting) // 6,5 м
  expect(far).toBeGreaterThan(0)
  expect(far).toBeLessThan(near)
})

test('лампа за стеной картины (с обратной стороны) её не освещает', () => {
  expect(paintingLight(at(0, -11, 0, 1.8, -8), painting)).toBe(0)
})

test('картина на другой стене: нормаль берётся из rotation_y', () => {
  const east = { position: { x: 8, y: 1.8, z: 0 }, rotation_y: -Math.PI / 2 } // лицом в −X
  expect(paintingLight(at(5, 0, 8, 1.8, 0), east)).toBeCloseTo(1, 1)
  expect(paintingLight(at(11, 0, 8, 1.8, 0), east)).toBe(0)
})
