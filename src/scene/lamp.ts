import * as THREE from 'three'
import type { Beam } from '../lamp/illumination'
import type { SundayConfigLighting, SundayLamp } from '../network/sunday'

/** Параметры SpotLight по api-sunday.md §2. */
/** Интенсивность из api-sunday.md §2. */
const SPOT_INTENSITY = 3
/**
 * Во сколько раз SpotLight усилен на клиенте: при 3 свет тонет в общем свете белой галереи и не виден ни на людях,
 * ни на стенах. Серверу интенсивность не передаётся, это только вид.
 */
export const SPOT_GAIN = 3
const SPOT_DISTANCE_M = 8
const SPOT_ANGLE = Math.PI / 6
const SPOT_PENUMBRA = 0.5
const SPOT_DECAY = 2
/** Наклон вниз при head_pitch = 0. */
export const BASE_TILT = Math.PI / 4
/** Высота шарнира головки над полом. */
const HEAD_Y = 1.1

/** Цвет видимого луча и пятна на полу: насыщеннее цвета SpotLight, иначе на яркой стене различия не видно. */
export const BEAM_COLORS: Record<SundayConfigLighting, string> = {
  warm: '#ffa94d',
  neutral: '#fff6e0',
  cool: '#74b0ff',
}

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
  /** Скрывает модель, оставляя свет (лампа в руке самого игрока). */
  setModelVisible(visible: boolean): void
  carry(position: { x: number; y: number; z: number }, yaw: number, headPitch?: number): void
  /** Луч сейчас: из шарнира головки по направлению света; на нём считается подсветка картин. */
  beam(): Beam
  dispose(): void
}

/** Плафон: закрыт сзади, открыт спереди (−Z), с обеих сторон непрозрачный — через него ничего не просвечивает. */
export function createShadeGeometry(rBack: number, rFront: number, length: number): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(
    [new THREE.Vector2(0, -length / 2), new THREE.Vector2(rBack, -length / 2), new THREE.Vector2(rFront, length / 2)],
    24,
  )
  g.rotateX(-Math.PI / 2) // ось Y → −Z: широкий край смотрит вперёд
  return g
}

/** Мягкий диск для светового пятна; без DOM (тесты) — ровный диск. */
function softDiscTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.55, 'rgba(255,255,255,0.55)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

/** Длина видимого луча, м, и предел расстояния до пятна на полу. */
const BEAM_LEN = 3.2
const POOL_MAX_DIST_M = 4

/** Светильник: основание, стойка и поворотная головка с SpotLight, видимым лучом и пятном на полу. Без теней. */
export function createLamp(): LampView {
  const owned: { dispose(): void }[] = []
  const own = <T extends { dispose(): void }>(x: T): T => (owned.push(x), x)
  const metal = own(new THREE.MeshStandardMaterial({ color: '#2b2b2e', roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide }))
  const bulb = own(new THREE.MeshStandardMaterial({ color: '#fff3d6', emissive: '#fff3d6', emissiveIntensity: 1, side: THREE.DoubleSide }))
  const glow = (opacity: number, map: THREE.Texture | null) =>
    own(
      new THREE.MeshBasicMaterial({
        color: '#ffffff',
        map,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      }),
    )

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
  const shade = new THREE.Mesh(own(createShadeGeometry(0.1, 0.16, 0.26)), metal)
  shade.position.z = -0.1
  const lens = new THREE.Mesh(own(new THREE.CircleGeometry(0.11, 16)), bulb)
  lens.rotation.y = Math.PI
  lens.position.z = -0.1
  // Видимый луч: прозрачный конус из раструба, цвет по `lighting`.
  const beamMaterial = glow(0.09, null)
  const beamGeometry = own(new THREE.ConeGeometry(BEAM_LEN * Math.tan(SPOT_ANGLE) * 0.9, BEAM_LEN, 32, 1, true))
  beamGeometry.translate(0, -BEAM_LEN / 2, 0) // вершина в начале координат, основание внизу
  beamGeometry.rotateX(Math.PI / 2) // вниз по Y → вперёд по −Z
  const beam = new THREE.Mesh(beamGeometry, beamMaterial)
  beam.position.z = -0.22
  const spot = new THREE.SpotLight('#ffffff', SPOT_INTENSITY, SPOT_DISTANCE_M, SPOT_ANGLE, SPOT_PENUMBRA, SPOT_DECAY)
  spot.castShadow = false
  spot.position.set(0, 0, 0) // у Light по умолчанию (0, 1, 0): источник должен сидеть ровно в шарнире головки
  spot.target.position.set(0, 0, -1)
  head.add(shade, lens, beam, spot, spot.target)

  // Пятно света на полу там, куда упирается луч: показывает, куда лампа светит, даже на ярком полу.
  const poolTexture = softDiscTexture()
  if (poolTexture) owned.push(poolTexture)
  const poolMaterial = glow(0.5, poolTexture)
  const poolGeometry = own(new THREE.CircleGeometry(1, 32))
  poolGeometry.rotateX(-Math.PI / 2)
  const pool = new THREE.Mesh(poolGeometry, poolMaterial)
  const poolPivot = new THREE.Group()
  poolPivot.add(pool)
  object.add(base, post, head, poolPivot)

  let on = true
  let modelVisible = true
  let aimYaw = 0
  let aimPitch = 0

  /** Ставит пятно: пересечение луча из головки с полом (y = 0) в мировых координатах, у `object` нет поворота. */
  function aimPool(yaw: number, headPitch: number) {
    aimYaw = yaw
    aimPitch = headPitch
    const d = lampDirection(yaw, headPitch)
    const headY = object.position.y + HEAD_Y
    const reach = d.y < -0.02 ? headY / -d.y : Infinity
    const horizontal = reach * Math.hypot(d.x, d.z)
    if (!on || !(horizontal <= POOL_MAX_DIST_M)) {
      poolPivot.visible = false
      return
    }
    poolPivot.visible = true
    poolPivot.position.set(d.x * reach, -object.position.y + 0.02, d.z * reach)
    poolPivot.rotation.y = yaw
    const radius = Math.min(1.5, Math.max(0.3, reach * Math.tan(SPOT_ANGLE)))
    // Наклонный луч растягивает круг вдоль направления взгляда лампы.
    const stretch = Math.min(2.5, 1 / Math.max(-d.y, 0.4))
    pool.scale.set(radius, 1, radius * stretch)
  }

  return {
    object,
    spot,
    apply(lamp, slot, lighting) {
      object.position.set(slot.x, slot.y, slot.z)
      head.rotation.y = lamp.yaw
      head.rotation.x = -(BASE_TILT + lamp.head_pitch)
      on = lamp.on
      spot.color.set(SPOT_COLORS[lighting])
      beamMaterial.color.set(BEAM_COLORS[lighting])
      poolMaterial.color.set(BEAM_COLORS[lighting])
      // Свет не удаляем и не добавляем: смена числа источников пересобирает шейдеры всей сцены.
      spot.intensity = lamp.on ? SPOT_INTENSITY * SPOT_GAIN : 0
      bulb.emissiveIntensity = lamp.on ? 1 : 0.05
      beam.visible = modelVisible && on
      aimPool(lamp.yaw, lamp.head_pitch)
    },
    setModelVisible(visible) {
      // Свою лампу в руке игрок видит в оверлее: в мире остаётся свет и пятно, а луч у самых глаз не рисуем.
      modelVisible = visible
      base.visible = post.visible = shade.visible = lens.visible = visible
      beam.visible = visible && on
    },
    carry(position, yaw, headPitch = 0) {
      object.position.set(position.x, position.y, position.z)
      head.rotation.y = yaw
      head.rotation.x = -(BASE_TILT + headPitch)
      aimPool(yaw, headPitch)
    },
    beam() {
      const d = lampDirection(aimYaw, aimPitch)
      return {
        origin: { x: object.position.x, y: object.position.y + HEAD_Y, z: object.position.z },
        dir: { x: d.x, y: d.y, z: d.z },
        on,
      }
    },
    dispose() {
      owned.forEach((x) => x.dispose())
      owned.length = 0
    },
  }
}
