import * as THREE from 'three'
import type { Room } from '../network/contract'
import type { SundayConfigLighting, SundayRoomRuntime } from '../network/sunday'
import { createInstallation, STAND_OFFSET, type InstallationView } from './installation'
import { createLamp, type LampView } from './lamp'
import { heldAim, heldPosition, type HeldPose } from '../lamp/lampActions'
import type { GuideActor } from './roomBuilder'

/** Живое состояние зала по `world.runtime`: отделка, свет, гиды, стенд и лампа. Принадлежит построенному залу. */
export type RuntimeView = {
  /** Применяет полный снимок: идемпотентно, лишнего не пересоздаёт. */
  apply(runtime: SundayRoomRuntime): void
  /** Где сейчас держащий лампу (каждый кадр); null — его нет в зале, лампа скрыта. Без держателя не действует. */
  setHolderPose(pose: HeldPose | null, own?: boolean): void
  /** Ещё не отправленный поворот головки: показываем сразу, не дожидаясь ответа сервера. null — убрать. */
  setLampPreview(aim: { yaw: number; head_pitch: number } | null): void
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
  /** Основной направленный свет галереи: тонируется вместе с общим, иначе пол и стены почти не меняются. */
  sun?: THREE.DirectionalLight
  guides: GuideActor[]
  /** Стены с текстурой штукатурки: цвет умножается на неё, поэтому акцент разбавляется белым. */
  textured: boolean
}

/**
 * Оттенок общего света для `lighting`: насыщеннее цвета SpotLight, потому что именно общий свет (небо, пол, солнце)
 * определяет, как выглядит зал, и тёплый или холодный зал должен читаться с первого взгляда.
 */
const LIGHT_TINT: Record<SundayConfigLighting, string> = { neutral: '#ffffff', warm: '#ffb066', cool: '#8ab8ff' }
/** Доля оттенка в цвете общего света: заметно, но картины не окрашиваются целиком (у них свой неосвещаемый материал). */
const AMBIENT_TINT = 0.8
/** Доля акцента в цвете стены с текстурой: иначе стены темнеют, а штукатурка пропадает. */
const TEXTURED_ACCENT = 0.5

export function lightingTint(lighting: SundayConfigLighting): THREE.Color {
  return new THREE.Color('#ffffff').lerp(new THREE.Color(LIGHT_TINT[lighting]), AMBIENT_TINT)
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
  const { group, bounds, walls, ambient, guides, textured, sun } = parts
  const baseSky = ambient.color.clone()
  const baseGround = ambient.groundColor.clone()
  const baseSun = sun?.color.clone()
  let lamp: LampView | null = null
  let stand: InstallationView | null = null
  const guideSeen = new Map<string, string>()
  let held = false
  let heldPose: HeldPose | null = null
  let ownHeld = false
  let preview: { yaw: number; head_pitch: number } | null = null
  let lastRt: SundayRoomRuntime | null = null

  // Метки мест для лампы: кольца на полу видны, только пока лампа в руках у самого игрока.
  const markerGeometry = new THREE.RingGeometry(0.34, 0.44, 40)
  const markerMaterial = new THREE.MeshBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })
  const markers = new THREE.Group()
  markers.name = 'lamp_slot_markers'
  markers.visible = false
  group.add(markers)
  let markerKey = ''
  let markerT = 0

  function syncMarkers(rt: SundayRoomRuntime) {
    const key = rt.config.lamp_slots.map((sl) => `${sl.slot_id}:${sl.position.x}:${sl.position.z}`).join('|')
    if (key !== markerKey) {
      markerKey = key
      markers.clear()
      for (const sl of rt.config.lamp_slots) {
        const ring = new THREE.Mesh(markerGeometry, markerMaterial)
        ring.rotation.x = -Math.PI / 2
        ring.position.set(sl.position.x, 0.03, sl.position.z)
        markers.add(ring)
      }
    }
    markers.visible = ownHeld && rt.lamp.holder_user_id !== null
  }

  function applyLamp(rt: SundayRoomRuntime) {
    const slot = rt.config.lamp_slots.find((s) => s.slot_id === rt.lamp.slot_id)
    if (!slot) return
    if (!lamp) {
      lamp = createLamp()
      group.add(lamp.object)
    }
    lamp.apply(preview && rt.lamp.holder_user_id === null ? { ...rt.lamp, ...preview } : rt.lamp, slot.position, rt.config.lighting)
    held = rt.lamp.holder_user_id !== null
    lamp.object.visible = true
    placeHeld()
    syncMarkers(rt)
  }

  /** Лампа в руках стоит у игрока, иначе на своём слоте (его положение apply() уже задал). */
  function placeHeld() {
    if (!lamp) return
    if (!held) return lamp.setModelVisible(true)
    lamp.object.visible = heldPose !== null
    // Свою лампу игрок видит в руке (оверлей): в мире остаётся только её свет.
    lamp.setModelVisible(!ownHeld)
    if (heldPose) {
      const pitch = heldPose.pitch === undefined ? 0 : heldAim(heldPose.yaw, heldPose.pitch).head_pitch
      lamp.carry(heldPosition(heldPose), heldPose.yaw, pitch)
    }
  }

  return {
    apply(rt) {
      const { config } = rt

      const tint = wallTint(config.accent_color, textured)
      for (const w of walls) (w.material as THREE.MeshStandardMaterial).color.copy(tint)

      const tone = lightingTint(config.lighting)
      ambient.color.copy(baseSky).multiply(tone)
      ambient.groundColor.copy(baseGround).multiply(tone)
      if (sun && baseSun) sun.color.copy(baseSun).multiply(tone)

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

      lastRt = rt
      applyLamp(rt)
    },
    setHolderPose(pose, own = false) {
      heldPose = pose
      ownHeld = own
      placeHeld()
      if (lastRt) markers.visible = ownHeld && lastRt.lamp.holder_user_id !== null
    },
    setLampPreview(aim) {
      preview = aim
      if (lastRt) applyLamp(lastRt)
    },
    update(dtS) {
      if (markers.visible) {
        markerT += dtS
        markerMaterial.opacity = 0.55 + 0.3 * Math.sin(markerT * 4)
      }
      if (stand?.object.visible) stand.update(dtS)
    },
    dispose() {
      markers.removeFromParent()
      markerGeometry.dispose()
      markerMaterial.dispose()
      lamp?.object.removeFromParent()
      stand?.object.removeFromParent()
      lamp?.dispose()
      stand?.dispose()
      lamp = null
      stand = null
    },
  }
}
