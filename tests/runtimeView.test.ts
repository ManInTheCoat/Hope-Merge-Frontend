import { expect, spyOn, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as THREE from 'three'
import type { Room, Surface } from '../src/network/contract'
import type { SundayRoomRuntime } from '../src/network/sunday'
import { STAND_OFFSET, STAND_SIZE } from '../src/scene/installation'
import { lampDirection, SPOT_COLORS } from '../src/scene/lamp'
import { buildRoom } from '../src/scene/roomBuilder'
import { lightingTint, wallTint } from '../src/scene/runtimeView'

const fixture: SundayRoomRuntime = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures', 'sunday', 'world.runtime.json'), 'utf8'),
).payload

const wall = (id: string, x: number): Surface => ({ id, position: { x, y: 2, z: 0 }, size: { x: 0.2, y: 4, z: 12 }, color: '#d8d2c4', collidable: true })

const room: Room = {
  id: fixture.room_id,
  world_version: fixture.world_version,
  title: 'Зал',
  bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 12, y: 4, z: 12 } },
  surfaces: [wall('w1', 0), wall('w2', 12), { id: 'f', position: { x: 6, y: -0.05, z: 6 }, size: { x: 12, y: 0.1, z: 12 }, color: '#999', collidable: false }],
  doors: [],
  exhibits: [],
  guides: [{ id: 'guide_leonardo', display_name: 'База', subtitle: 'Старое', position: { x: 1, y: 0, z: 1 }, rotation_y: 0, interaction_radius_m: 3 }],
}

const labelFn = (text: string) => {
  const g = new THREE.Group()
  g.name = text
  return g
}

const rt = (patch: (r: SundayRoomRuntime) => void): SundayRoomRuntime => {
  const r = structuredClone(fixture)
  patch(r)
  return r
}

const built = () => buildRoom(room, new Map(), labelFn)
const find = (b: ReturnType<typeof buildRoom>, name: string) => b.group.getObjectByName(name)

test('lampDirection: нули — −Z с наклоном вниз π/4; head_pitch прибавляется к наклону; yaw — вокруг Y', () => {
  const d0 = lampDirection(0, 0)
  expect(d0.x).toBeCloseTo(0)
  expect(d0.y).toBeCloseTo(-Math.SQRT1_2)
  expect(d0.z).toBeCloseTo(-Math.SQRT1_2)
  expect(lampDirection(0, Math.PI / 4).y).toBeCloseTo(-1) // π/4 + π/4 — отвесно вниз
  expect(lampDirection(0, -Math.PI / 4).y).toBeCloseTo(0) // горизонтально
  const d90 = lampDirection(Math.PI / 2, 0)
  expect(d90.x).toBeCloseTo(-Math.SQRT1_2)
  expect(d90.z).toBeCloseTo(0)
})

test('лампа появляется на слоте, SpotLight по §2, направление совпадает с lampDirection', () => {
  const b = built()
  b.runtime.apply(rt((r) => Object.assign(r.lamp, { yaw: 0.7, head_pitch: 0.3 })))
  const lamp = find(b, 'lamp_01')!
  const slot = fixture.config.lamp_slots.find((s) => s.slot_id === fixture.lamp.slot_id)!
  expect(lamp.position.toArray()).toEqual([slot.position.x, slot.position.y, slot.position.z])
  const spot = lamp.getObjectByProperty('isSpotLight', true) as THREE.SpotLight
  expect(spot.intensity).toBe(3)
  expect(spot.distance).toBe(8)
  expect(spot.angle).toBeCloseTo(Math.PI / 6)
  expect(spot.penumbra).toBe(0.5)
  expect(spot.decay).toBe(2)
  expect(spot.castShadow).toBe(false)
  b.group.updateMatrixWorld(true)
  const from = new THREE.Vector3().setFromMatrixPosition(spot.matrixWorld)
  const to = new THREE.Vector3().setFromMatrixPosition(spot.target.matrixWorld)
  const dir = to.sub(from).normalize()
  expect(dir.distanceTo(lampDirection(0.7, 0.3))).toBeLessThan(1e-6)
})

test('лампа: on=false гасит свет, не удаляя источник; цвет по lighting; смена слота двигает лампу', () => {
  const b = built()
  b.runtime.apply(rt((r) => Object.assign(r.lamp, { on: false })))
  const spot = find(b, 'lamp_01')!.getObjectByProperty('isSpotLight', true) as THREE.SpotLight
  expect(spot.intensity).toBe(0)
  b.runtime.apply(
    rt((r) => {
      r.revision = 2
      r.config.lighting = 'warm'
      r.lamp.slot_id = 'b'
    }),
  )
  expect(spot.intensity).toBe(3)
  expect(`#${spot.color.getHexString()}`.toUpperCase()).toBe(SPOT_COLORS.warm)
  expect(find(b, 'lamp_01')!.position.x).toBe(9)
  expect(b.group.children.filter((o) => o.name === 'lamp_01')).toHaveLength(1)
})

test('лампа в руках игрока на слоте не рисуется', () => {
  const b = built()
  b.runtime.apply(rt((r) => (r.lamp.holder_user_id = 'user_1')))
  expect(find(b, 'lamp_01')!.visible).toBe(false)
  b.runtime.apply(
    rt((r) => {
      r.revision = 2
      r.lamp.holder_user_id = null
    }),
  )
  expect(find(b, 'lamp_01')!.visible).toBe(true)
})

test('стенд «Цвет и свет»: нет, пока installation_visible=false; есть на (6,0,3) от угла зала; скрывается обратно', () => {
  const b = built()
  b.runtime.apply(fixture)
  expect(find(b, 'installation')).toBeUndefined()
  const withStand = (revision: number, visible: boolean) =>
    rt((r) => {
      r.revision = revision
      r.config.installation_visible = visible
    })
  b.runtime.apply(withStand(2, true))
  const stand = find(b, 'installation')!
  expect(stand.visible).toBe(true)
  expect(stand.position.toArray()).toEqual([STAND_OFFSET.x, 0, STAND_OFFSET.z])
  expect(stand.children.length).toBe(3) // основание и две створки
  const box = new THREE.Box3().setFromObject(stand)
  expect(box.max.y).toBeCloseTo(STAND_SIZE.y)
  b.runtime.apply(withStand(3, false))
  expect(stand.visible).toBe(false)
  b.runtime.apply(withStand(4, true))
  expect(b.group.children.filter((o) => o.name === 'installation')).toHaveLength(1) // тот же объект, без дубля
  expect(stand.visible).toBe(true)
})

test('створки стенда качаются со временем', () => {
  const b = built()
  b.runtime.apply(rt((r) => (r.config.installation_visible = true)))
  const hinge = find(b, 'installation')!.children[1]
  const before = hinge.rotation.y
  b.runtime.update(0.9)
  expect(hinge.rotation.y).not.toBe(before)
})

test('accent_color красит стены, lighting — оттенок общего света', () => {
  const b = built()
  const walls = b.group.children.filter((o) => o.userData.id === 'w1' || o.userData.id === 'w2') as THREE.Mesh[]
  const floor = b.group.children.find((o) => o.userData.id === 'f') as THREE.Mesh
  const floorColor = (floor.material as THREE.MeshStandardMaterial).color.getHex()
  b.runtime.apply(
    rt((r) => {
      r.config.accent_color = '#336699'
      r.config.lighting = 'cool'
    }),
  )
  for (const w of walls) expect((w.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('336699')
  expect((floor.material as THREE.MeshStandardMaterial).color.getHex()).toBe(floorColor) // пол не тронут
  const hemi = b.group.children.find((o) => (o as THREE.HemisphereLight).isHemisphereLight) as THREE.HemisphereLight
  expect(hemi.color.getHex()).toBe(lightingTint('cool').getHex())
  expect(lightingTint('neutral').getHex()).toBe(0xffffff)
  expect(lightingTint('warm').b).toBeLessThan(lightingTint('warm').r)
})

test('wallTint: с текстурой акцент разбавлен белым, неверный цвет — белый', () => {
  expect(wallTint('#000000', true).getHex()).not.toBe(0)
  expect(wallTint('#336699', false).getHexString()).toBe('336699')
  const warn = spyOn(console, 'warn').mockImplementation(() => {}) // three сообщает о неизвестном цвете
  expect(wallTint('не цвет', false).getHex()).toBe(0xffffff)
  warn.mockRestore()
})

test('гиды: положение, поворот и имя из runtime; подпись пересоздаётся только при смене имени', () => {
  const b = built()
  const actor = b.guides[0]
  const labelBefore = actor.label
  const moved = (revision: number, x: number, z: number) =>
    rt((r) => {
      r.revision = revision
      r.guides[0] = { ...r.guides[0], display_name: 'Леонардо', subtitle: 'Учебная реконструкция', position: { x, y: 0, z }, rotation_y: 1 }
    })
  b.runtime.apply(moved(1, 6, 7.5))
  expect(actor.object.position.toArray()).toEqual([6, 0, 7.5])
  expect(actor.object.rotation.y).toBe(1)
  expect(actor.label).not.toBe(labelBefore)
  expect(actor.label.name).toBe('Леонардо')
  expect(actor.label.parent).toBe(actor.object)
  expect(labelBefore.parent).toBeNull()
  const labelNow = actor.label
  b.runtime.apply(moved(2, 2, 2))
  expect(actor.label).toBe(labelNow)
  expect(actor.object.position.toArray()).toEqual([2, 0, 2])
})

test('runtime гида, которого нет в зале, игнорируется', () => {
  const b = built()
  expect(() => b.runtime.apply(rt((r) => (r.guides[0].guide_id = 'guide_ghost')))).not.toThrow()
  expect(b.guides[0].object.position.toArray()).toEqual([1, 0, 1])
})

test('dispose зала убирает лампу и стенд, повторный вызов безопасен', () => {
  const b = built()
  b.runtime.apply(rt((r) => (r.config.installation_visible = true)))
  b.dispose()
  expect(b.group.children).toHaveLength(0)
  expect(() => b.runtime.dispose()).not.toThrow()
})
