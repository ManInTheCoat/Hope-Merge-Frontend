import * as THREE from 'three'
import type { SundayNPCState } from '../network/sunday'
import { headYaw, limbSwing, STRIDE_RAD_PER_M } from './gait'
import { BODY, partTransforms, type PartName } from './layout'
import { NPC_MAX } from './limits'
import { NpcBuffers, type NpcPose } from './npcBuffer'

/** Не дальше этого от NPC игрок считается собеседником при `talking` (api-sunday.md §5: 3 м). */
const TALK_RANGE_M = 3

export type Crowd = {
  /** Применяет полный снимок npc.state (отсутствующие NPC удаляются). */
  apply(state: SundayNPCState, nowMs: number): void
  /** Раскладывает инстансы на кадр; возвращает интерполированные позы для логики (просьба пройти). */
  update(dtS: number, nowMs: number, player: { x: number; z: number } | null): NpcPose[]
  /** Убирает меши из сцены и освобождает геометрии, материалы и буферы инстансов. */
  dispose(): void
}

const SKIN = ['#e8c9a6', '#d9a679', '#b97e53', '#8d5a3b', '#f1d3b5']
const CLOTHES = ['#3f6f8f', '#8f3f4a', '#4a7d52', '#7a5ca0', '#b08a3e', '#5d6d7e', '#a65d3a', '#2f5d62']
const TROUSERS = ['#2b2f3a', '#3a3a3a', '#4a3b2c', '#26364a']

const numberOf = (id: string) => Number(/(\d+)$/.exec(id)?.[1] ?? 0)

/** Один набор общих геометрий и материалов, по `InstancedMesh` на часть тела. Без теней, текстур и имён. */
export function createCrowd(parent: THREE.Object3D, maxCount = NPC_MAX): Crowd {
  const geoms = {
    head: new THREE.SphereGeometry(BODY.headRadius, 12, 8),
    torso: new THREE.BoxGeometry(BODY.torsoWidth, BODY.torsoHeight, BODY.torsoDepth),
    arms: new THREE.BoxGeometry(0.1, BODY.armLength, 0.1).translate(0, -BODY.armLength / 2, 0),
    legs: new THREE.BoxGeometry(0.14, BODY.legLength, 0.14).translate(0, -BODY.legLength / 2, 0),
  }
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 })
  const mesh = (g: THREE.BufferGeometry, per: number) => {
    const m = new THREE.InstancedMesh(g, material, maxCount * per)
    m.count = 0
    m.castShadow = false
    m.receiveShadow = false
    m.frustumCulled = false
    m.name = 'npc'
    parent.add(m)
    return m
  }
  const head = mesh(geoms.head, 1)
  const torso = mesh(geoms.torso, 1)
  const arms = mesh(geoms.arms, 2)
  const legs = mesh(geoms.legs, 2)
  const all = [head, torso, arms, legs]

  const buffers = new NpcBuffers()
  /** Накопленная фаза шага по NPC: стартует с `phase` из снимка, дальше растёт с пройденным путём. */
  const stride = new Map<string, number>()
  let instance: string | null = null

  const body = new THREE.Matrix4()
  const local = new THREE.Matrix4()
  const out = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const euler = new THREE.Euler()
  const pos = new THREE.Vector3()
  const one = new THREE.Vector3(1, 1, 1)
  const color = new THREE.Color()

  const put = (m: THREE.InstancedMesh, i: number, t: { position: [number, number, number]; rotation: [number, number, number] }) => {
    euler.set(t.rotation[0], t.rotation[1], t.rotation[2])
    q.setFromEuler(euler)
    pos.set(t.position[0], t.position[1], t.position[2])
    local.compose(pos, q, one)
    out.multiplyMatrices(body, local)
    m.setMatrixAt(i, out)
  }
  const tint = (m: THREE.InstancedMesh, i: number, hex: string) => m.setColorAt(i, color.set(hex))

  return {
    apply(state, nowMs) {
      // Новая симуляция: фаза шага начинается заново с `phase` из снимка.
      if (state.room_instance_id !== instance) stride.clear()
      instance = state.room_instance_id
      buffers.apply(state.npcs.slice(0, maxCount), nowMs, instance)
    },

    update(dtS, nowMs, player) {
      const poses = buffers.sample(nowMs)
      const alive = new Set<string>()
      poses.forEach((p, i) => {
        alive.add(p.id)
        let acc = stride.get(p.id)
        if (acc === undefined) acc = p.phase
        acc += p.speed_mps * dtS * STRIDE_RAD_PER_M
        stride.set(p.id, acc)

        const near = player && Math.hypot(player.x - p.x, player.z - p.z) <= TALK_RANGE_M ? player : null
        // Поворот головы считаем в системе тела: цель — игрок, взгляд — вдоль −Z при yaw = 0.
        const turn = headYaw(p.yaw, p.state, near, p)
        const parts = partTransforms(limbSwing(acc, p.speed_mps), turn)

        body.makeRotationY(p.yaw).setPosition(p.x, 0, p.z)
        const n = numberOf(p.id)
        for (const t of parts) {
          const name: PartName = t.part
          if (name === 'head') put(head, i, t)
          else if (name === 'torso') put(torso, i, t)
          else if (name === 'armL') put(arms, i * 2, t)
          else if (name === 'armR') put(arms, i * 2 + 1, t)
          else if (name === 'legL') put(legs, i * 2, t)
          else put(legs, i * 2 + 1, t)
        }
        tint(head, i, SKIN[n % SKIN.length])
        tint(torso, i, CLOTHES[n % CLOTHES.length])
        tint(arms, i * 2, CLOTHES[n % CLOTHES.length])
        tint(arms, i * 2 + 1, CLOTHES[n % CLOTHES.length])
        tint(legs, i * 2, TROUSERS[n % TROUSERS.length])
        tint(legs, i * 2 + 1, TROUSERS[n % TROUSERS.length])
      })
      for (const id of [...stride.keys()]) if (!alive.has(id)) stride.delete(id)

      head.count = torso.count = poses.length
      arms.count = legs.count = poses.length * 2
      for (const m of all) {
        m.instanceMatrix.needsUpdate = true
        if (m.instanceColor) m.instanceColor.needsUpdate = true
      }
      return poses
    },

    dispose() {
      for (const m of all) {
        parent.remove(m)
        m.dispose()
      }
      for (const g of Object.values(geoms)) g.dispose()
      material.dispose()
      buffers.clear()
      stride.clear()
    },
  }
}
