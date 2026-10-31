import { expect, test } from 'bun:test'
import { SnapshotBuffer } from '../src/players/interpolation'

const s = (t: number, x: number, yaw = 0, epoch = 1) => ({ t, x, z: 0, yaw, epoch })

test('середина между двумя снимками', () => {
  const b = new SnapshotBuffer()
  b.push(s(0, 0))
  b.push(s(100, 1))
  expect(b.sample(50)).toEqual({ x: 0.5, z: 0, yaw: 0 })
})

test('после последнего снимка стоим на месте, без экстраполяции', () => {
  const b = new SnapshotBuffer()
  b.push(s(0, 0))
  b.push(s(100, 1))
  expect(b.sample(500)?.x).toBe(1)
})

test('до первого снимка — первый снимок', () => {
  const b = new SnapshotBuffer()
  b.push(s(0, 0))
  b.push(s(100, 1))
  expect(b.sample(-50)?.x).toBe(0)
})

test('пустой буфер → null', () => {
  expect(new SnapshotBuffer().sample(0)).toBeNull()
})

test('yaw по кратчайшей дуге через ±π', () => {
  const b = new SnapshotBuffer()
  b.push(s(0, 0, 3.0))
  b.push(s(100, 0, -3.0))
  const yaw = b.sample(50)!.yaw
  expect(Math.abs(yaw)).toBeGreaterThan(3.1)
  expect(yaw).toBeGreaterThanOrEqual(-Math.PI)
  expect(yaw).toBeLessThan(Math.PI)
})

test('смена epoch сбрасывает буфер', () => {
  const b = new SnapshotBuffer()
  b.push(s(0, 0, 0, 1))
  b.push(s(100, 1, 0, 2))
  expect(b.sample(50)?.x).toBe(1)
  expect(b.size).toBe(1)
})

test('скачок больше 2 м сбрасывает буфер', () => {
  const b = new SnapshotBuffer()
  b.push(s(0, 0))
  b.push(s(100, 5))
  expect(b.sample(50)?.x).toBe(5)
})

test('снимки старше 1000 мс от последнего удаляются', () => {
  const b = new SnapshotBuffer()
  for (let i = 0; i <= 15; i++) b.push(s(i * 100, i * 0.1))
  expect(b.size).toBeLessThanOrEqual(11)
  expect(b.sample(1400)?.x).toBeCloseTo(1.4)
})
