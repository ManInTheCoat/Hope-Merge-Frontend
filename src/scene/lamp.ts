import * as THREE from 'three'
import type { SundayConfigLighting, SundayLamp } from '../network/sunday'

/** Параметры SpotLight по api-sunday.md §2. */
const SPOT_INTENSITY = 3
const SPOT_DISTANCE_M = 8
const SPOT_ANGLE = Math.PI / 6
const SPOT_PENUMBRA = 0.5
const SPOT_DECAY = 2
/** Наклон вниз при head_pitch = 0. */
const BASE_TILT = Math.PI / 4
/** Высота шарнира головки над полом. */
const HEAD_Y = 1.1

export const SPOT_COLORS: Record<SundayConfigLighting, string> = {
  warm: '#FFD6A0',
  neutral: '#FFFFFF',
  cool: '#C5DFFF',
}

/** Направление света: при нулях — −Z с наклоном вниз π/4, head_pitch прибавляется к наклону, yaw — вокруг Y. */
export function lampDirection(yaw: number, headPitch: number): THREE.Vector3 {
  const tilt = BASE_TILT + headPitch
  return new THREE.Vector3(-Math.sin(yaw) * Math.cos(tilt), -Math.sin(tilt), -Math.cos(yaw) * Math.cos(tilt))
}

export type LampView = {
  object: THREE.Group
  spot: THREE.SpotLight
  /** Положение (слот), углы, включённость и цвет света. */
  apply(lamp: SundayLamp, slot: { x: number; y: number; z: number }, lighting: SundayConfigLighting): void
  /** Лампа в руках: положение у игрока, головка смотрит по его yaw (api-sunday.md §2). После apply() возвращается на слот. */
  carry(position: { x: number; y: number; z: number }, yaw: number): void
  dispose(): void
}

/** Светильник: основание, стойка и поворотная головка с SpotLight. Только примитивы, без теней. */
export function createLamp(): LampView {
  const owned: { dispose(): void }[] = []
  const own = <T extends { dispose(): void }>(x: T): T => (owned.push(x), x)
  const metal = own(new THREE.MeshStandardMaterial({ color: '#2b2b2e', roughness: 0.5, metalness: 0.4 }))
  const bulb = own(new THREE.MeshStandardMaterial({ color: '#fff3d6', emissive: '#fff3d6', emissiveIntensity: 1 }))

  const object = new THREE.Group()
  object.name = 'lamp_01'
  const base = new THREE.Mesh(own(new THREE.CylinderGeometry(0.28, 0.32, 0.06, 20)), metal)
  base.position.y = 0.03
  const post = new THREE.Mesh(own(new THREE.CylinderGeometry(0.025, 0.025, HEAD_Y - 0.06, 10)), metal)
  post.position.y = 0.06 + (HEAD_Y - 0.06) / 2

  // Головка: ось вращения по YXZ — сначала yaw, затем наклон; −Z локально смотрит туда, куда светит лампа.
  const head = new THREE.Group()
  head.rotation.order = 'YXZ'
  head.position.y = HEAD_Y
  const shade = new THREE.Mesh(own(new THREE.CylinderGeometry(0.16, 0.1, 0.26, 16, 1, true)), metal)
  shade.rotation.x = -Math.PI / 2 // раструб смотрит в −Z
  shade.position.z = -0.1
  const lens = new THREE.Mesh(own(new THREE.CircleGeometry(0.11, 16)), bulb)
  lens.rotation.y = Math.PI
  lens.position.z = -0.1
  const spot = new THREE.SpotLight('#ffffff', SPOT_INTENSITY, SPOT_DISTANCE_M, SPOT_ANGLE, SPOT_PENUMBRA, SPOT_DECAY)
  spot.castShadow = false
  spot.position.set(0, 0, 0) // у Light по умолчанию (0, 1, 0): источник должен сидеть ровно в шарнире головки
  spot.target.position.set(0, 0, -1)
  head.add(shade, lens, spot, spot.target)
  object.add(base, post, head)

  return {
    object,
    spot,
    apply(lamp, slot, lighting) {
      object.position.set(slot.x, slot.y, slot.z)
      head.rotation.y = lamp.yaw
      head.rotation.x = -(BASE_TILT + lamp.head_pitch)
      spot.color.set(SPOT_COLORS[lighting])
      // Свет не удаляем и не добавляем: смена числа источников пересобирает шейдеры всей сцены.
      spot.intensity = lamp.on ? SPOT_INTENSITY : 0
      bulb.emissiveIntensity = lamp.on ? 1 : 0.05
    },
    carry(position, yaw) {
      object.position.set(position.x, position.y, position.z)
      head.rotation.y = yaw
      head.rotation.x = -BASE_TILT
    },
    dispose() {
      owned.forEach((x) => x.dispose())
      owned.length = 0
    },
  }
}
