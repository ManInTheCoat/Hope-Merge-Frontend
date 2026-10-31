import * as THREE from 'three'
import type { Room } from '../network/contract'
import { surfacesToColliders, type Aabb, type Bounds2 } from './collision'
import { makeLabel } from './labels'

export type BuiltRoom = {
  group: THREE.Group
  colliders: Aabb[]
  bounds: Bounds2
  exhibitMeshes: Map<string, THREE.Mesh>
  /** Освобождает геометрии, материалы и текстуры. Битмапы закрывает RoomManager.unload(). */
  dispose(): void
}

type LabelFn = (text: string, widthM: number) => THREE.Object3D

const DOOR_WIDTH = 1.2
const DOOR_HEIGHT = 2.2

export function buildRoom(room: Room, bitmaps: Map<string, ImageBitmap>, labelFn: LabelFn = makeLabel): BuiltRoom {
  const group = new THREE.Group()
  group.name = room.id

  group.add(new THREE.HemisphereLight(0xffffff, 0x887766, 1.6))
  group.add(new THREE.AmbientLight(0xffffff, 0.6))

  for (const s of room.surfaces) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(s.size.x, s.size.y, s.size.z),
      new THREE.MeshStandardMaterial({ color: s.color }),
    )
    mesh.position.set(s.position.x, s.position.y, s.position.z)
    mesh.userData = { kind: 'surface', id: s.id }
    group.add(mesh)
  }

  const exhibitMeshes = new Map<string, THREE.Mesh>()
  for (const e of room.exhibits) {
    const bitmap = bitmaps.get(e.image_asset_id)
    let material: THREE.MeshBasicMaterial
    if (bitmap) {
      const texture = new THREE.Texture(bitmap)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.flipY = false // ImageBitmap уже перевёрнут при декодировании, UNPACK_FLIP_Y для него не действует
      texture.needsUpdate = true
      material = new THREE.MeshBasicMaterial({ map: texture })
    } else {
      material = new THREE.MeshBasicMaterial({ color: '#777777' })
    }
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(e.width_m, e.height_m), material)
    mesh.position.set(e.position.x, e.position.y, e.position.z)
    mesh.rotation.y = e.rotation_y
    mesh.userData = { kind: 'exhibit', id: e.id }

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(e.width_m + 0.16, e.height_m + 0.16, 0.04),
      new THREE.MeshStandardMaterial({ color: '#3b2f25' }),
    )
    frame.position.z = -0.03
    mesh.add(frame)

    group.add(mesh)
    exhibitMeshes.set(e.id, mesh)
  }

  for (const d of room.doors) {
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(DOOR_WIDTH, DOOR_HEIGHT, 0.05),
      new THREE.MeshStandardMaterial({ color: '#2a211b' }),
    )
    door.position.set(d.position.x, DOOR_HEIGHT / 2, d.position.z)
    door.userData = { kind: 'door', id: d.id }
    const facing = Math.atan2(-d.position.x, -d.position.z) // лицом к центру зала
    const label = labelFn(d.label, 1.8)
    label.position.set(d.position.x, DOOR_HEIGHT + 0.4, d.position.z)
    label.rotation.y = facing
    group.add(door, label)
  }

  for (const g of room.guides) {
    const figure = new THREE.Group()
    figure.userData = { kind: 'guide', id: g.id }
    figure.position.set(g.position.x, g.position.y, g.position.z)
    figure.rotation.y = g.rotation_y

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.9, 4, 12), new THREE.MeshStandardMaterial({ color: '#3f6f8f' }))
    body.position.y = 0.73
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), new THREE.MeshStandardMaterial({ color: '#e8c9a6' }))
    head.position.y = 1.55
    const label = labelFn(g.display_name, 1.2)
    label.position.y = 2.0
    figure.add(body, head, label)
    group.add(figure)
  }

  return {
    group,
    colliders: surfacesToColliders(room.surfaces),
    bounds: { minX: room.bounds.min.x, maxX: room.bounds.max.x, minZ: room.bounds.min.z, maxZ: room.bounds.max.z },
    exhibitMeshes,
    dispose() {
      group.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.geometry.dispose()
        for (const mat of [mesh.material].flat()) {
          ;(mat as THREE.MeshBasicMaterial).map?.dispose()
          mat.dispose()
        }
      })
      group.clear()
    },
  }
}
