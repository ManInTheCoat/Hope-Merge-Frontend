import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { buildRoom } from '../src/scene/roomBuilder'
import type { Room, Surface } from '../src/network/contract'

const surface = (id: string, collidable: boolean, x = 0): Surface => ({
  id,
  position: { x, y: 2, z: 0 },
  size: { x: 1, y: 4, z: 1 },
  color: '#d8d2c4',
  collidable,
})

const room: Room = {
  id: 'hall',
  world_version: 'v1',
  title: 'Зал',
  bounds: { min: { x: -6, y: 0, z: -8 }, max: { x: 6, y: 4, z: 8 } },
  surfaces: [surface('floor', false), surface('wall_n', true, 1), surface('wall_s', true, 2)],
  doors: [{ id: 'door_1', target_room_id: 'other', label: 'В другой зал', position: { x: 0, y: 0, z: 7.7 }, interaction_radius_m: 1.5 }],
  exhibits: [
    {
      id: 'ex_1',
      title: 'Амфора',
      description: '',
      image_asset_id: 'asset_1',
      position: { x: -3, y: 1.8, z: -7.95 },
      rotation_y: 0,
      width_m: 2,
      height_m: 1.5,
      interaction_radius_m: 3,
    },
    {
      id: 'ex_2',
      title: 'Бюст',
      description: '',
      image_asset_id: 'asset_2',
      position: { x: 3, y: 1.8, z: -7.95 },
      rotation_y: 0,
      width_m: 2,
      height_m: 1.5,
      interaction_radius_m: 3,
    },
  ],
  guides: [{ id: 'guide_1', display_name: 'Куратор', subtitle: '', position: { x: 3, y: 0, z: -3 }, rotation_y: 0, interaction_radius_m: 3 }],
}

const stubLabel = () => new THREE.Group()
const fakeBitmap = { width: 4, height: 4, close() {} } as unknown as ImageBitmap

test('меш на каждую поверхность, коллайдеры только collidable', () => {
  const built = buildRoom(room, new Map(), stubLabel)
  const surfaces = built.group.children.filter((o) => o.userData.kind === 'surface')
  expect(surfaces.length).toBe(3)
  expect(built.colliders.length).toBe(2)
  expect(built.bounds).toEqual({ minX: -6, maxX: 6, minZ: -8, maxZ: 8 })
})


test('картина без битмапа не падает', () => {
  expect(() => buildRoom(room, new Map(), stubLabel)).not.toThrow()
})

test('дверь и гид добавлены с id из данных', () => {
  const built = buildRoom(room, new Map(), stubLabel)
  const found = (kind: string) => {
    const out: THREE.Object3D[] = []
    built.group.traverse((o) => o.userData.kind === kind && out.push(o))
    return out
  }
  expect(found('door').map((o) => o.userData.id)).toEqual(['door_1'])
  expect(found('guide').map((o) => o.userData.id)).toEqual(['guide_1'])
})

test('dispose освобождает геометрии, материалы и текстуры', () => {
  const built = buildRoom(room, new Map([['asset_1', fakeBitmap], ['asset_2', fakeBitmap]]), stubLabel)
  const disposed = { geometry: 0, material: 0, texture: 0 }
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  built.group.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    geometries.add(mesh.geometry)
    for (const mat of [mesh.material].flat()) materials.add(mat)
  })
  geometries.forEach((g) => g.addEventListener('dispose', () => disposed.geometry++))
  materials.forEach((mat) => {
    mat.addEventListener('dispose', () => disposed.material++)
    const map = (mat as THREE.MeshStandardMaterial).map
    map?.addEventListener('dispose', () => disposed.texture++)
  })
  built.dispose()
  expect(disposed.geometry).toBe(geometries.size)
  expect(disposed.material).toBe(materials.size)
  expect(disposed.texture).toBe(2)
})

const walled: Room = {
  ...room,
  surfaces: [
    { id: 'wall_s', position: { x: 0, y: 2, z: 8.1 }, size: { x: 12.4, y: 4, z: 0.2 }, color: '#ccc', collidable: true },
    { id: 'wall_e', position: { x: 6.1, y: 2, z: 0 }, size: { x: 0.2, y: 4, z: 16 }, color: '#ccc', collidable: true },
  ],
  doors: [
    { id: 'door_s', target_room_id: 'x', label: 'Юг', position: { x: 0, y: 0, z: 7.7 }, interaction_radius_m: 1.5 },
    { id: 'door_e', target_room_id: 'x', label: 'Восток', position: { x: 5.7, y: 0, z: 1 }, interaction_radius_m: 1.5 },
  ],
}

function doorById(built: ReturnType<typeof buildRoom>, id: string): THREE.Object3D {
  let found: THREE.Object3D | null = null
  built.group.traverse((o) => {
    if (o.userData.kind === 'door' && o.userData.id === id) found = o
  })
  return found!
}

const facing = (o: THREE.Object3D) => ({ x: Math.sin(o.rotation.y), z: Math.cos(o.rotation.y) })

test('дверь стоит вплотную к ближайшей стене, а не в точке взаимодействия', () => {
  const built = buildRoom(walled, new Map(), stubLabel)
  const s = doorById(built, 'door_s')
  expect(Math.abs(s.position.z - 8.0)).toBeLessThan(0.05)
  expect(s.position.x).toBe(0)
  const e = doorById(built, 'door_e')
  expect(Math.abs(e.position.x - 6.0)).toBeLessThan(0.05)
  expect(e.position.z).toBe(1)
})

test('дверь смотрит внутрь зала', () => {
  const built = buildRoom(walled, new Map(), stubLabel)
  const s = facing(doorById(built, 'door_s'))
  expect(s.z).toBeLessThan(-0.99)
  const e = facing(doorById(built, 'door_e'))
  expect(e.x).toBeLessThan(-0.99)
})

test('низкий постамент рядом с точкой двери не считается стеной', () => {
  const r: Room = {
    ...room,
    bounds: { min: { x: 10, y: 0, z: 10 }, max: { x: 20, y: 4, z: 20 } },
    surfaces: [{ id: 'plinth', position: { x: 13.1, y: 0.5, z: 12 }, size: { x: 1, y: 1, z: 1 }, color: '#ccc', collidable: true }],
    doors: [{ id: 'd', target_room_id: 'x', label: 'Д', position: { x: 12, y: 0, z: 12 }, interaction_radius_m: 1.5 }],
    exhibits: [],
    guides: [],
  }
  const d = doorById(buildRoom(r, new Map(), stubLabel), 'd')
  expect(d.position.x).toBe(12)
  expect(d.position.z).toBe(12)
})

test('без стены рядом дверь смотрит к центру зала, а не к началу координат', () => {
  const r: Room = {
    ...room,
    bounds: { min: { x: 10, y: 0, z: 10 }, max: { x: 20, y: 4, z: 20 } },
    surfaces: [],
    doors: [{ id: 'd', target_room_id: 'x', label: 'Д', position: { x: 12, y: 0, z: 15 }, interaction_radius_m: 1.5 }],
    exhibits: [],
    guides: [],
  }
  const f = facing(doorById(buildRoom(r, new Map(), stubLabel), 'd'))
  expect(f.x).toBeGreaterThan(0.99) // центр (15,15) — по +X
})

test('таблички гидов отдаются наружу, чтобы поворачивать их к камере', () => {
  const r: Room = {
    ...room,
    guides: [{ id: 'g', display_name: 'Куратор', subtitle: '', position: { x: 0, y: 0, z: 0 }, rotation_y: 0, interaction_radius_m: 3 }],
  }
  expect(buildRoom(r, new Map(), stubLabel).guideLabels.length).toBe(1)
})
