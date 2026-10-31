import { expect, test } from 'bun:test'
import { pickDoor, pickTarget } from '../src/scene/targeting'
import type { Exhibit } from '../src/network/contract'

/** Экспонат под прицелом: то же, что pickTarget без гидов. */
function pickExhibit(input: Parameters<typeof pickTarget>[0], exhibits: Exhibit[]): Exhibit | null {
  const t = pickTarget(input, exhibits, [])
  return t?.kind === 'exhibit' ? t.exhibit : null
}
import type { Door, Exhibit, Guide } from '../src/network/contract'

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
  const input = { eye: { x: -3.95, y: 1.65, z: 0 }, dir: { x: -1, y: 0, z: 0 } }
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

const door = (id: string, x: number, z: number, y = 0): Door =>
  ({ id, target_room_id: 'r', label: id, position: { x, y, z }, interaction_radius_m: 1.5 }) as Door

test('pickDoor: пустой список — null', () => {
  expect(pickDoor({ x: 0, z: 0 }, [])).toBeNull()
})

test('pickDoor: дверь в 1,2 м находится', () => {
  expect(pickDoor({ x: 0, z: 0 }, [door('d', 1.2, 0)])?.id).toBe('d')
})

test('pickDoor: дверь в 1,4 м — null', () => {
  expect(pickDoor({ x: 0, z: 0 }, [door('d', 0, 1.4)])).toBeNull()
})

test('pickDoor: из двух в радиусе — ближайшая', () => {
  expect(pickDoor({ x: 0, z: 0 }, [door('far', 1.1, 0), door('near', 0, 0.5)])?.id).toBe('near')
})

test('pickDoor: высота не учитывается', () => {
  expect(pickDoor({ x: 0, z: 0 }, [door('d', 1, 0, 5)])?.id).toBe('d')
})

const guide = (x: number, z: number): Guide => ({
  id: 'g',
  display_name: 'Куратор',
  subtitle: '',
  position: { x, y: 0, z },
  rotation_y: 0,
  interaction_radius_m: 3,
})
const g = guide(0, -3)

test('смотрит на гида с 2 м — цель гид', () => {
  expect(pickTarget(look(0, -1), [], [g])).toEqual({ kind: 'guide', guide: g })
})

test('гид за спиной — нет цели', () => {
  expect(pickTarget(look(0, -1, { x: 0, y: 0, z: 1 }), [], [g])).toBeNull()
})

test('гид дальше 2.8 м — нет цели', () => {
  expect(pickTarget(look(0, 0), [], [g])).toBeNull()
})

test('взгляд мимо гида в сторону — нет цели', () => {
  expect(pickTarget(look(0, -1, { x: 0.6, y: 0, z: -0.8 }), [], [g])).toBeNull()
})

test('стена между камерой и гидом — нет цели', () => {
  const wall = { minX: -2, maxX: 2, minY: 0, maxY: 3, minZ: -2.1, maxZ: -1.9 }
  expect(pickTarget({ ...look(0, -1), colliders: [wall] }, [], [g])).toBeNull()
})

test('экспонат ближе гида по лучу — цель экспонат', () => {
  // экспонат на высоте глаз в 1 м перед камерой, гид за ним
  const near = { ...ex('near', 0, -2), position: { x: 0, y: 1.65, z: -2 } }
  expect(pickTarget(look(0, -1), [near], [g])).toEqual({ kind: 'exhibit', exhibit: near })
})

test('гид ближе экспоната по лучу — цель гид', () => {
  const far = { ...ex('far', 0, -3.5), position: { x: 0, y: 1.65, z: -3.5 } }
  expect(pickTarget(look(0, -1), [far], [g])).toEqual({ kind: 'guide', guide: g })
})

test('без гидов pickTarget совпадает с pickExhibit', () => {
  expect(pickTarget(look(0, -5.95), [main], [])).toEqual({ kind: 'exhibit', exhibit: main })
  expect(pickTarget(look(0, -4), [main], [])).toBeNull()
})

test('pickDoor: дверь за стеной не подсвечивается (сервер проверяет видимость от глаз)', () => {
  const wall = { minX: -2, maxX: 2, minY: 0, maxY: 4, minZ: 0.4, maxZ: 0.6 }
  expect(pickDoor({ x: 0, z: 0 }, [door('d', 0, 1)], [wall])).toBeNull()
  expect(pickDoor({ x: 0, z: 0 }, [door('d', 0, 1)], [])?.id).toBe('d')
})

test('pickDoor: пол под точкой двери не закрывает её', () => {
  const floor = { minX: -10, maxX: 10, minY: -0.2, maxY: 0, minZ: -10, maxZ: 10 }
  expect(pickDoor({ x: 0, z: 0 }, [door('d', 0, 1)], [floor])?.id).toBe('d')
})
