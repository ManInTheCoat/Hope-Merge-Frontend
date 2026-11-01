import type { Room, Vec3 } from '../contract'
import type { SundayNPC, SundayNPCState } from '../sunday'
import { mockSweep, mockValidPose } from './geometry'

/*
 * Симуляция посетителей зала (api-sunday.md §5), которую на сервере ведёт FSM с тиком 5 Гц. Правила:
 * walking → idle при игроке ближе 1 м; talking 3 с (с продлением) после chat.send с текстом, если
 * отправитель ≤ 3 м; дистанции — XZ; скорость 0,6 м/с; маршруты детерминированы world_version + room_id +
 * индекс NPC и идут только по валидным точкам и отрезкам геометрии зала.
 */

export const NPC_SPEED_MPS = 0.6
export const NPC_STOP_RANGE_M = 1
export const NPC_TALK_RANGE_M = 3
export const NPC_TALK_MS = 3000
const STRIDE_RAD_PER_M = 5
const GRID_STEP_M = 0.5
const EXHIBIT_REACH_M = 2
const TARGET_TRIES = 12
const TWO_PI = Math.PI * 2

type Rng = () => number

/** FNV-1a → mulberry32: короткий детерминированный генератор из строки. */
function seeded(text: string): Rng {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Talk = { userId: string; at: number; until: number; pos: Vec3 }
type Walker = {
  id: string
  rng: Rng
  pos: Vec3
  yaw: number
  phase: number
  target: Vec3 | null
  talk: Talk | null
  state: SundayNPC['state']
  speed: number
}

export type SimPlayer = { user_id: string; position: Vec3 }

const dist2d = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z)
/** Взгляд при yaw = 0 — вдоль −Z (как у игроков). */
const yawTo = (from: { x: number; z: number }, to: { x: number; z: number }) => Math.atan2(-(to.x - from.x), -(to.z - from.z))
const npcId = (i: number) => `npc_${String(i).padStart(2, '0')}`

export class NpcSim {
  private readonly walkers: Walker[] = []
  private readonly spots: Vec3[]
  private seq = 0
  private readonly room: Room
  private readonly worldVersion: string
  private readonly instanceId: string

  constructor(room: Room, worldVersion: string, count: number, instanceId: string) {
    this.room = room
    this.worldVersion = worldVersion
    this.instanceId = instanceId
    this.spots = collectSpots(room)
    this.setCount(count)
  }

  /** Меняет число NPC: лишние убираются с конца, новые добавляются с ID по порядку. */
  setCount(n: number): void {
    const want = Math.max(0, Math.min(40, Math.floor(n)))
    this.walkers.length = Math.min(this.walkers.length, want)
    while (this.walkers.length < want) this.walkers.push(this.spawn(this.walkers.length))
  }

  /** Принятый chat.send с непустым текстом: NPC в пределах 3 м от отправителя поворачиваются к нему на 3 с. */
  chat(userId: string, pos: Vec3, nowMs: number): void {
    for (const w of this.walkers) {
      if (dist2d(w.pos, pos) > NPC_TALK_RANGE_M) continue
      const cur = w.talk && w.talk.until > nowMs ? w.talk : null
      const newer = !cur || nowMs > cur.at || (nowMs === cur.at && userId < cur.userId)
      if (newer) w.talk = { userId, at: nowMs, until: nowMs + NPC_TALK_MS, pos: { ...pos } }
      else if (cur && cur.userId === userId) cur.until = nowMs + NPC_TALK_MS
    }
  }

  step(dtS: number, nowMs: number, players: SimPlayer[]): void {
    for (const w of this.walkers) {
      const talk = w.talk && w.talk.until > nowMs ? w.talk : null
      if (!talk) w.talk = null
      if (talk) {
        const sender = players.find((p) => p.user_id === talk.userId)
        w.state = 'talking'
        w.speed = 0
        w.yaw = yawTo(w.pos, sender?.position ?? talk.pos)
      } else if (players.some((p) => dist2d(p.position, w.pos) < NPC_STOP_RANGE_M)) {
        w.state = 'idle'
        w.speed = 0
      } else {
        this.walk(w, dtS)
      }
    }
  }

  snapshot(): SundayNPCState {
    this.seq += 1
    return {
      world_version: this.worldVersion,
      room_id: this.room.id,
      room_instance_id: this.instanceId,
      seq: this.seq,
      npcs: this.walkers.map((w) => ({
        npc_id: w.id,
        position: { x: w.pos.x, y: 0, z: w.pos.z },
        yaw: w.yaw,
        state: w.state,
        speed_mps: w.speed,
        phase: w.phase,
      })),
    }
  }

  private spawn(index: number): Walker {
    const rng = seeded(`${this.worldVersion}|${this.room.id}|${index}`)
    const pos = this.spots.length ? { ...this.spots[Math.floor(rng() * this.spots.length)] } : { x: 0, y: 0, z: 0 }
    const w: Walker = {
      id: npcId(index),
      rng,
      pos,
      yaw: rng() * TWO_PI - Math.PI,
      phase: rng() * TWO_PI,
      target: null,
      talk: null,
      state: 'walking',
      speed: 0,
    }
    this.pickTarget(w)
    if (w.target) w.speed = NPC_SPEED_MPS
    else w.state = 'idle'
    return w
  }

  private pickTarget(w: Walker): void {
    for (let i = 0; i < TARGET_TRIES; i++) {
      const c = this.spots[Math.floor(w.rng() * this.spots.length)]
      if (c && dist2d(c, w.pos) > 0.5 && mockSweep(this.room, w.pos, c)) {
        w.target = { ...c }
        return
      }
    }
    w.target = null
  }

  private walk(w: Walker, dtS: number): void {
    if (!w.target) this.pickTarget(w)
    if (!w.target) {
      w.state = 'idle'
      w.speed = 0
      return
    }
    w.state = 'walking'
    w.speed = NPC_SPEED_MPS
    const remaining = dist2d(w.pos, w.target)
    const move = Math.min(NPC_SPEED_MPS * dtS, remaining)
    if (remaining > 1e-9) {
      w.yaw = yawTo(w.pos, w.target)
      w.pos = { x: w.pos.x + ((w.target.x - w.pos.x) / remaining) * move, y: 0, z: w.pos.z + ((w.target.z - w.pos.z) / remaining) * move }
      w.phase = (w.phase + move * STRIDE_RAD_PER_M) % TWO_PI
    }
    if (move >= remaining - 1e-9) {
      w.pos = { ...w.target }
      this.pickTarget(w)
    }
  }
}

/** Точки сетки, пригодные для стояния; те, что у экспонатов, предпочтительнее — посетители «смотрят картины». */
function collectSpots(room: Room): Vec3[] {
  const { min, max } = room.bounds
  const all: Vec3[] = []
  for (let x = min.x; x <= max.x; x += GRID_STEP_M) {
    for (let z = min.z; z <= max.z; z += GRID_STEP_M) {
      const p = { x, y: 0, z }
      if (mockValidPose(room, p)) all.push(p)
    }
  }
  const near = all.filter((p) => room.exhibits.some((e) => dist2d(p, e.position) <= EXHIBIT_REACH_M))
  return near.length >= 4 ? near : all
}
