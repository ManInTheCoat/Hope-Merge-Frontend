import * as THREE from 'three'
import type { Room } from '../network/contract'
import type { SundayConfigLighting, SundayRoomRuntime } from '../network/sunday'
import { createInstallation, STAND_OFFSET, type InstallationView } from './installation'
import { createLamp, SPOT_COLORS, type LampView } from './lamp'
import { heldPosition, type HeldPose } from '../lamp/lampActions'
import type { GuideActor } from './roomBuilder'

/** Живое состояние зала по `world.runtime`: отделка, свет, гиды, стенд и лампа. Принадлежит построенному залу. */
export type RuntimeView = {
  /** Применяет полный снимок: идемпотентно, лишнего не пересоздаёт. */
  apply(runtime: SundayRoomRuntime): void
  /** Где сейчас держащий лампу (каждый кадр); null — его нет в зале, лампа скрыта. Без держателя не действует. */
  setHolderPose(pose: HeldPose | null): void
  update(dtS: number): void
  dispose(): void
}

export type RuntimeViewParts = {
  group: THREE.Object3D
  bounds: Room['bounds']
  /** Стены, на которые ложится `accent_color`. */
  walls: THREE.Mesh[]
  /** Общий свет, чей оттенок задаёт `lighting`. */
  ambient: THREE.HemisphereLight
  guides: GuideActor[]
  /** Стены с текстурой штукатурки: цвет умножается на неё, поэтому акцент разбавляется белым. */
  textured: boolean
}

/** Доля оттенка `lighting` в цвете общего света: заметно, но не заливает картины. */
const AMBIENT_TINT = 0.45
/** Доля акцента в цвете стены с текстурой: иначе стены темнеют, а штукатурка пропадает. */
const TEXTURED_ACCENT = 0.5

export function lightingTint(lighting: SundayConfigLighting): THREE.Color {
  return new THREE.Color('#ffffff').lerp(new THREE.Color(SPOT_COLORS[lighting]), AMBIENT_TINT)
}

export function wallTint(accent: string, textured: boolean): THREE.Color {
  const c = new THREE.Color()
  try {
    c.set(accent)
  } catch {
    return new THREE.Color('#ffffff')
  }
  return textured ? new THREE.Color('#ffffff').lerp(c, TEXTURED_ACCENT) : c
}

export function createRuntimeView(parts: RuntimeViewParts): RuntimeView {
  const { group, bounds, walls, ambient, guides, textured } = parts
  let lamp: LampView | null = null
  let stand: InstallationView | null = null
  const guideSeen = new Map<string, string>()
  let held = false
  let heldPose: HeldPose | null = null

  /** Лампа в руках стоит у игрока, иначе на своём слоте (его положение apply() уже задал). */
  function placeHeld() {
    if (!lamp || !held) return
    lamp.object.visible = heldPose !== null
    if (heldPose) lamp.carry(heldPosition(heldPose), heldPose.yaw)
  }

  return {
    apply(rt) {
      const { config } = rt

      const tint = wallTint(config.accent_color, textured)
      for (const w of walls) (w.material as THREE.MeshStandardMaterial).color.copy(tint)

      ambient.color.copy(lightingTint(config.lighting))

      for (const g of rt.guides) {
        const actor = guides.find((a) => a.id === g.guide_id)
        if (!actor) continue
        // Подпись пересоздаём только при смене имени или подзаголовка.
        const key = `${g.display_name}\n${g.subtitle}`
        if (guideSeen.get(g.guide_id) !== key) {
          actor.rename(g.display_name, g.subtitle)
          guideSeen.set(g.guide_id, key)
        }
        actor.place({ x: g.position.x, y: g.position.y, z: g.position.z }, g.rotation_y)
      }

      if (config.installation_visible && !stand) {
        stand = createInstallation()
        stand.object.position.set(bounds.min.x + STAND_OFFSET.x, 0, bounds.min.z + STAND_OFFSET.z)
        group.add(stand.object)
      }
      if (stand) stand.object.visible = config.installation_visible

      const slot = config.lamp_slots.find((s) => s.slot_id === rt.lamp.slot_id)
      if (slot) {
        if (!lamp) {
          lamp = createLamp()
          group.add(lamp.object)
        }
        lamp.apply(rt.lamp, slot.position, config.lighting)
        held = rt.lamp.holder_user_id !== null
        lamp.object.visible = true
        placeHeld()
      }
    },
    setHolderPose(pose) {
      heldPose = pose
      placeHeld()
    },
    update(dtS) {
      if (stand?.object.visible) stand.update(dtS)
    },
    dispose() {
      lamp?.object.removeFromParent()
      stand?.object.removeFromParent()
      lamp?.dispose()
      stand?.dispose()
      lamp = null
      stand = null
    },
  }
}
