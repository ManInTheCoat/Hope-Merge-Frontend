import * as THREE from 'three'
import { makeLabel } from '../scene/labels'
import { RENDER_DELAY_MS } from './interpolation'
import type { PlayerRegistry } from './registry'

const RADIUS = 0.3
const HEIGHT = 1.8
const EYE_HEIGHT = 1.65
const LABEL_HEIGHT = 2.1
const LABEL_WIDTH = 0.9

type Avatar = {
  group: THREE.Group
  material: THREE.MeshLambertMaterial
  label: THREE.Mesh
  name: string
  color: string
}

function disposeLabel(label: THREE.Mesh) {
  label.removeFromParent()
  label.geometry.dispose()
  const m = label.material as THREE.MeshBasicMaterial
  m.map?.dispose()
  m.dispose()
}

/** Капсулы удалённых игроков: цвет из `avatar_color`, козырёк по направлению взгляда, имя над головой. */
export class RemotePlayersView {
  private readonly scene: THREE.Scene
  private readonly avatars = new Map<string, Avatar>()
  // Общие для всех капсул и живут, пока открыта страница: весят несколько килобайт.
  private readonly body = new THREE.CapsuleGeometry(RADIUS, HEIGHT - 2 * RADIUS).translate(0, HEIGHT / 2, 0)
  private readonly visor = new THREE.BoxGeometry(0.36, 0.1, 0.12)
  private readonly visorMaterial = new THREE.MeshLambertMaterial({ color: 0x1a1a1f })

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  update(registry: PlayerRegistry, roomId: string, now: number, camera: THREE.Camera): void {
    const seen = new Set<string>()
    for (const p of registry.visible(roomId)) {
      const pose = p.buffer.sample(now - RENDER_DELAY_MS)
      if (!pose) continue
      seen.add(p.userId)
      let a = this.avatars.get(p.userId)
      if (!a) {
        a = this.create(p.displayName, p.color)
        this.avatars.set(p.userId, a)
      }
      if (a.name !== p.displayName) {
        disposeLabel(a.label)
        a.label = this.makeName(p.displayName)
        a.name = p.displayName
      }
      if (a.color !== p.color) {
        a.material.color.set(p.color)
        a.color = p.color
      }
      a.group.position.set(pose.x, 0, pose.z)
      a.group.rotation.y = pose.yaw
      a.label.position.set(pose.x, LABEL_HEIGHT, pose.z)
      a.label.quaternion.copy(camera.quaternion)
    }
    for (const [id, a] of this.avatars) {
      if (!seen.has(id)) {
        this.remove(a)
        this.avatars.delete(id)
      }
    }
  }

  /** Убирает все капсулы; объект остаётся пригодным для дальнейших update(). */
  clear(): void {
    this.avatars.forEach((a) => this.remove(a))
    this.avatars.clear()
  }

  private create(name: string, color: string): Avatar {
    const material = new THREE.MeshLambertMaterial({ color })
    const group = new THREE.Group()
    group.add(new THREE.Mesh(this.body, material))
    const visor = new THREE.Mesh(this.visor, this.visorMaterial)
    // При yaw = 0 взгляд вдоль −Z.
    visor.position.set(0, EYE_HEIGHT, -(RADIUS - 0.03))
    group.add(visor)
    this.scene.add(group)
    return { group, material, label: this.makeName(name), name, color }
  }

  private makeName(name: string): THREE.Mesh {
    const label = makeLabel(name, LABEL_WIDTH) as THREE.Mesh
    this.scene.add(label)
    return label
  }

  private remove(a: Avatar): void {
    a.group.removeFromParent()
    a.material.dispose()
    disposeLabel(a.label)
  }
}
