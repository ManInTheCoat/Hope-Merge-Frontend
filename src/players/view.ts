import * as THREE from 'three'
import { clipForSpeed, pickModel } from '../characters/catalog'
import { blobShadow, type CharacterLibrary, type Figure } from '../characters/library'
import { makeLabel } from '../scene/labels'
import { RENDER_DELAY_MS } from './interpolation'
import type { PlayerRegistry } from './registry'

const RADIUS = 0.3
const HEIGHT = 1.8
const EYE_HEIGHT = 1.65
const LABEL_HEIGHT = 2.1
const LABEL_WIDTH = 0.9
/** Дальше этого фигурки не анимируются: стоят в последней позе. */
const ANIMATE_DISTANCE_M = 25
/** Постоянная сглаживания скорости, с: интерполяция даёт рывки на границах снимков. */
const SPEED_SMOOTH_S = 0.15

type Avatar = {
  group: THREE.Group
  /** Только у капсулы-заглушки (библиотека моделей не загрузилась). */
  material: THREE.MeshLambertMaterial | null
  figure: Figure | null
  label: THREE.Mesh
  name: string
  color: string
  last: { x: number; z: number } | null
  speed: number
}

function disposeLabel(label: THREE.Mesh) {
  label.removeFromParent()
  label.geometry.dispose()
  const m = label.material as THREE.MeshBasicMaterial
  m.map?.dispose()
  m.dispose()
}

/** Удалённые игроки: анимированные фигурки (или капсулы, пока моделей нет), имя над головой. */
export class RemotePlayersView {
  private readonly scene: THREE.Scene
  private library: CharacterLibrary | null
  private readonly avatars = new Map<string, Avatar>()
  // Общие для всех капсул и живут, пока открыта страница: весят несколько килобайт.
  private readonly body = new THREE.CapsuleGeometry(RADIUS, HEIGHT - 2 * RADIUS).translate(0, HEIGHT / 2, 0)
  private readonly visor = new THREE.BoxGeometry(0.36, 0.1, 0.12)
  private readonly visorMaterial = new THREE.MeshLambertMaterial({ color: 0x1a1a1f })
  private lastNow = 0

  constructor(scene: THREE.Scene, library: CharacterLibrary | null = null) {
    this.scene = scene
    this.library = library
  }

  /** Модели догрузились: капсулы пересоздаются фигурками при следующем update(). */
  setLibrary(library: CharacterLibrary): void {
    this.library = library
    this.clear()
  }

  /** Переиспользуется между кадрами. */
  private readonly seen = new Set<string>()

  update(registry: PlayerRegistry, roomId: string, now: number, camera: THREE.Camera): void {
    const dt = this.lastNow ? Math.min((now - this.lastNow) / 1000, 0.25) : 0
    this.lastNow = now
    const seen = this.seen
    seen.clear()
    for (const p of registry.visible(roomId)) {
      const pose = p.buffer.sample(now - RENDER_DELAY_MS)
      if (!pose) continue
      seen.add(p.userId)
      let a = this.avatars.get(p.userId)
      if (!a) {
        a = this.create(p.userId, p.displayName, p.color)
        this.avatars.set(p.userId, a)
      }
      if (a.name !== p.displayName || a.color !== p.color) {
        disposeLabel(a.label)
        a.label = this.makeName(p.displayName, p.color)
        a.name = p.displayName
        a.color = p.color
        a.material?.color.set(p.color)
      }
      if (dt > 0 && a.last) {
        const inst = Math.hypot(pose.x - a.last.x, pose.z - a.last.z) / dt
        a.speed += (inst - a.speed) * Math.min(1, dt / SPEED_SMOOTH_S)
      }
      a.last = { x: pose.x, z: pose.z }
      a.group.position.set(pose.x, 0, pose.z)
      a.group.rotation.y = pose.yaw
      a.label.position.set(pose.x, LABEL_HEIGHT, pose.z)
      a.label.quaternion.copy(camera.quaternion)
      if (a.figure && camera.position.distanceTo(a.group.position) < ANIMATE_DISTANCE_M) {
        a.figure.play(clipForSpeed(a.speed))
        a.figure.update(dt)
      }
    }
    for (const [id, a] of this.avatars) {
      if (!seen.has(id)) {
        this.remove(a)
        this.avatars.delete(id)
      }
    }
  }

  /** Убирает всех; объект остаётся пригодным для дальнейших update(). */
  clear(): void {
    this.avatars.forEach((a) => this.remove(a))
    this.avatars.clear()
  }

  private create(userId: string, name: string, color: string): Avatar {
    const group = new THREE.Group()
    let material: THREE.MeshLambertMaterial | null = null
    let figure: Figure | null = null
    if (this.library) {
      figure = this.library.create(pickModel(userId))
      group.add(figure.root, blobShadow())
    } else {
      material = new THREE.MeshLambertMaterial({ color })
      group.add(new THREE.Mesh(this.body, material))
      const visor = new THREE.Mesh(this.visor, this.visorMaterial)
      // При yaw = 0 взгляд вдоль −Z.
      visor.position.set(0, EYE_HEIGHT, -(RADIUS - 0.03))
      group.add(visor)
    }
    this.scene.add(group)
    return { group, material, figure, label: this.makeName(name, color), name, color, last: null, speed: 0 }
  }

  private makeName(name: string, color: string): THREE.Mesh {
    const label = makeLabel(name, LABEL_WIDTH, color) as THREE.Mesh
    this.scene.add(label)
    return label
  }

  private remove(a: Avatar): void {
    a.figure?.dispose()
    a.group.removeFromParent()
    a.material?.dispose()
    disposeLabel(a.label)
  }
}
