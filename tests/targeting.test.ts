import { expect, test } from 'bun:test'
import { pickExhibit } from '../src/scene/targeting'
import type { Exhibit } from '../src/network/contract'

const ex = (id: string, x: number, z: number, rotation_y = 0): Exhibit => ({
  id,
  title: id,
  description: '',
  image_asset_id: 'a',
  position: { x, y: 1.8, z },
  rotation_y,
  width_m: 2,
  height_m: 1.5,
  interaction_radius_m: 3,
})

const main = ex('main', 0, -7.95)
const look = (x: number, z: number, dir = { x: 0, y: 0, z: -1 }) => ({
  eye: { x, y: 1.65, z },
  dir,
  playerXZ: { x, z },
})

test('смотрит на картину с 2 м', () => {
  expect(pickExhibit(look(0, -5.95), [main])?.id).toBe('main')
})

test('дальше 2.8 м — нет цели', () => {
  expect(pickExhibit(look(0, -4), [main])).toBeNull()
})

test('мимо картины, на стену рядом', () => {
  expect(pickExhibit(look(1.5, -5.95), [main])).toBeNull()
})

test('поверх рамки', () => {
  const dir = { x: 0, y: 0.6, z: -0.8 }
  expect(pickExhibit(look(0, -5.95, dir), [main])).toBeNull()
})

test('сзади (через стену) не выбирается', () => {
  expect(pickExhibit(look(0, -9, { x: 0, y: 0, z: 1 }), [main])).toBeNull()
})

test('из двух картин берётся та, на которую смотрят', () => {
  const second = ex('second', 3, -7.95)
  expect(pickExhibit(look(0, -5.95), [main, second])?.id).toBe('main')
  expect(pickExhibit(look(3, -5.95), [main, second])?.id).toBe('second')
})

test('картина с rotation_y = π/2 смотрит в +X', () => {
  const side = ex('side', -5.95, 0, Math.PI / 2)
  const input = { eye: { x: -3.95, y: 1.65, z: 0 }, dir: { x: -1, y: 0, z: 0 }, playerXZ: { x: -3.95, z: 0 } }
  expect(pickExhibit(input, [side])?.id).toBe('side')
})

test('стена между камерой и картиной убирает цель', () => {
  // Перегородка высотой 4 м между глазом (z=-5.95) и картиной (z=-7.95).
  const partition = { minX: -3, maxX: 3, minY: 0, maxY: 4, minZ: -7.1, maxZ: -6.9 }
  expect(pickExhibit({ ...look(0, -5.95), colliders: [partition] }, [main])).toBeNull()
})

test('стена, на которой висит картина, не мешает', () => {
  const northWall = { minX: -6.2, maxX: 6.2, minY: 0, maxY: 4, minZ: -8.2, maxZ: -8.0 }
  expect(pickExhibit({ ...look(0, -5.95), colliders: [northWall] }, [main])?.id).toBe('main')
})

test('низкий барьер ниже линии взгляда не мешает', () => {
  const rail = { minX: -3, maxX: 3, minY: 0, maxY: 1, minZ: -7.1, maxZ: -6.9 }
  expect(pickExhibit({ ...look(0, -5.95), colliders: [rail] }, [main])?.id).toBe('main')
})
