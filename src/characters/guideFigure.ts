import * as THREE from 'three'
import type { GuideActor, GuideFactory } from '../scene/roomBuilder'
import { disposeLabel, makeGuideLabel } from '../scene/labels'
import { buildAccessory } from './accessories'
import { guideLook, pickModel } from './catalog'
import { blobShadow, type CharacterLibrary } from './library'

const LABEL_WIDTH_M = 1.4
const LABEL_HEIGHT_M = 2.25
/** Скорость поворота к игроку, рад/с. */
const TURN_SPEED = 3
/** Высота кости головы в модели Kenney (root → torso → head), единицы модели. */
const HEAD_BONE_Y = 0.343

/** Угол в (−π, π]. */
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/**
 * Фигурки гидов из библиотеки моделей. `rotation_y = 0` — гид смотрит в +Z, как экспонат (api.md §3);
 * фигурка Figure смотрит в −Z, поэтому базовый угол сдвинут на π.
 */
export function createGuideActor(library: CharacterLibrary): GuideFactory {
  return (g): GuideActor => {
    const look = guideLook(g.id, g.display_name)
    const figure = library.create(look?.model ?? pickModel(g.id))
    if (look) {
      if (look.outfit) figure.tintBody(look.outfit)
      const head = figure.head
      const headMesh = figure.root.getObjectByName('head-mesh') as THREE.Mesh | undefined
      if (head && headMesh) {
        headMesh.geometry.computeBoundingBox()
        const bb = headMesh.geometry.boundingBox!
        for (const kind of look.accessories) head.add(buildAccessory(kind, bb.max.y - HEAD_BONE_Y))
      }
    }
    const object = new THREE.Group()
    object.position.set(g.position.x, g.position.y, g.position.z)
    // Положение и поворот меняет runtime: актуальные значения лежат здесь, а не в исходном описании.
    const at = { x: g.position.x, z: g.position.z }
    let restYaw = g.rotation_y + Math.PI
    figure.root.rotation.y = restYaw
    const shadow = blobShadow()
    const accent = look?.accent ?? '#8a8a8a'
    const makeLabel = (name: string, subtitle: string) => {
      const l = makeGuideLabel(name, subtitle, LABEL_WIDTH_M, accent)
      l.position.y = LABEL_HEIGHT_M
      return l
    }
    const label0 = makeLabel(g.display_name, g.subtitle)
    object.add(figure.root, shadow, label0)

    let wasNear = false
    let gesturing = false
    const actor: GuideActor = {
      id: g.id,
      object,
      label: label0,
      update(dtS, player) {
        let targetYaw = restYaw
        const near =
          !!player && Math.hypot(player.x - at.x, player.z - at.z) <= g.interaction_radius_m
        if (near && player) targetYaw = Math.atan2(-(player.x - at.x), -(player.z - at.z))
        const diff = wrap(targetYaw - figure.root.rotation.y)
        const step = TURN_SPEED * dtS
        figure.root.rotation.y += Math.abs(diff) <= step ? diff : Math.sign(diff) * step
        if (near && !wasNear && !figure.busy) figure.play('emote-yes', 0.2, true)
        wasNear = near
        // Жест — зацикленный клип руки, пока гид отвечает; разовые кивки (busy) его прерывают.
        if (!figure.busy) figure.play(gesturing ? 'interact-right' : 'idle')
        figure.update(dtS)
      },
      greet() {
        figure.play('emote-yes', 0.15, true)
      },
      setGesturing(on) {
        gesturing = on
      },
      place(position, rotationY) {
        object.position.set(position.x, position.y, position.z)
        at.x = position.x
        at.z = position.z
        const next = rotationY + Math.PI
        // Гид стоял в позе покоя: разворачиваем сразу; если он уже повернулся к игроку, update() вернёт его сам.
        if (next !== restYaw && Math.abs(wrap(figure.root.rotation.y - restYaw)) < 1e-6) figure.root.rotation.y = next
        restYaw = next
      },
      rename(displayName, subtitle) {
        const old = actor.label
        actor.label = makeLabel(displayName, subtitle)
        object.add(actor.label)
        object.remove(old)
        disposeLabel(old)
      },
      dispose() {
        // Корень фигурки и тень — общие ресурсы библиотеки: убираем до обхода dispose() зала.
        figure.dispose()
        shadow.removeFromParent()
      },
    }
    return actor
  }
}
