import type { Room, Vec3 } from '../contract'
import type { SundayNPC, SundayNPCState } from '../sunday'
import { NPC_MAX } from '../../npc/limits'
import { mockSweep, mockValidPose } from './geometry'

/*
 * Симуляция посетителей зала (api-sunday.md §5), которую на сервере ведёт FSM с тиком 5 Гц. Посетитель
 * ходит между «делами»: смотрит картину, подходит к гиду, выходит через дверь и возвращается позже.
 * Поверх этого: walking → idle при игроке ближе 1 м; talking 3 с (с продлением) после chat.send с
 * текстом, если отправитель ≤ 3 м; дистанции — XZ; скорость 0,6 м/с. Маршруты детерминированы
 * world_version + room_id + индекс NPC и идут только по валидным точкам и отрезкам геометрии зала.
 * Число посетителей в зале колеблется: ушедшие через дверь отсутствуют в снимке (не больше трёх сразу).
 */

export const NPC_SPEED_MPS = 0.6
export const NPC_STOP_RANGE_M = 1
export const NPC_TALK_RANGE_M = 3
export const NPC_TALK_MS = 3000
/** Сколько посетителей одновременно могут быть за дверью. */
export const NPC_MAX_AWAY = 3
const STRIDE_RAD_PER_M = 5
const GRID_STEP_M = 0.5
const TARGET_TRIES = 12
/** На сколько точка входа в дверь сдвинута от неё внутрь зала, м. */
const DOOR_INSET_M = 0.15
const TWO_PI = Math.PI * 2
/** На каком расстоянии от картины и от гида стоят посетители, м. */
const VIEW_DIST_M: [number, number] = [1.4, 2]
const GUIDE_DIST_M: [number, number] = [1.1, 1.6]
/** Сколько секунд смотрят картину, слушают гида и ждут за дверью. */
const VIEW_S: [number, number] = [5, 12]
const GUIDE_S: [number, number] = [6, 10]
const AWAY_S: [number, number] = [8, 20]
/** Вероятности следующего дела: картина — остальное; дверь отбрасывается, если за дверью уже трое. */
const P_GUIDE = 0.2
const P_DOOR = 0.15

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

type Purpose = 'exhibit' | 'guide' | 'door'
type Mode =
  | { kind: 'go'; target: Vec3; purpose: Purpose; face: Vec3 | null }
  | { kind: 'dwell'; until: number; face: Vec3 | null }
  | { kind: 'away'; until: number }

type Talk = { userId: string; at: number; until: number; pos: Vec3 }
type Walker = {
  id: string
  rng: Rng
  pos: Vec3
  yaw: number
  phase: number
  mode: Mode
  lastExhibit: number
  talk: Talk | null
  state: SundayNPC['state']
  speed: number
}

export type SimPlayer = { user_id: string; position: Vec3 }

const dist2d = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z)
/** Взгляд при yaw = 0 — вдоль −Z (как у игроков). */
const yawTo = (from: { x: number; z: number }, to: { x: number; z: number }) => Math.atan2(-(to.x - from.x), -(to.z - from.z))
const npcId = (i: number) => `npc_${String(i).padStart(2, '0')}`
const between = (rng: Rng, [lo, hi]: [number, number]) => lo + rng() * (hi - lo)

export class NpcSim {
  private readonly walkers: Walker[] = []
  private readonly spots: Vec3[]
  private seq = 0
  /** Время симуляции, с: нужно для остановок и ожидания за дверью. */
  private clock = 0
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

  /** Меняет число NPC (не больше `NPC_MAX`): лишние убираются с конца, новые добавляются с ID по порядку. */
  setCount(n: number): void {
    const want = Math.max(0, Math.min(NPC_MAX, Math.floor(n)))
    this.walkers.length = Math.min(this.walkers.length, want)
    while (this.walkers.length < want) this.walkers.push(this.spawn(this.walkers.length))
  }

  /** Принятый chat.send с непустым текстом: NPC в пределах 3 м от отправителя поворачиваются к нему на 3 с. */
  chat(userId: string, pos: Vec3, nowMs: number): void {
    for (const w of this.walkers) {
      if (w.mode.kind === 'away' || dist2d(w.pos, pos) > NPC_TALK_RANGE_M) continue
      const cur = w.talk && w.talk.until > nowMs ? w.talk : null
      const newer = !cur || nowMs > cur.at || (nowMs === cur.at && userId < cur.userId)
      if (newer) w.talk = { userId, at: nowMs, until: nowMs + NPC_TALK_MS, pos: { ...pos } }
      else if (cur && cur.userId === userId) cur.until = nowMs + NPC_TALK_MS
    }
  }

  step(dtS: number, nowMs: number, players: SimPlayer[]): void {
    this.clock += dtS
    for (const w of this.walkers) {
      const m = w.mode
      if (m.kind === 'away') {
        if (this.clock >= m.until) this.choose(w) // вернулся: появляется у двери, где вошёл, и идёт по следующему делу
        continue
      }
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
      } else if (m.kind === 'dwell') {
        w.state = 'idle'
        w.speed = 0
        if (m.face) w.yaw = yawTo(w.pos, m.face)
      } else {
        this.walk(w, m, dtS)
        continue
      }
      // Остановка продолжается своим чередом, даже пока посетитель отвлёкся на игрока или разговор.
      if (w.mode.kind === 'dwell' && this.clock >= w.mode.until) this.choose(w)
    }
  }

  snapshot(): SundayNPCState {
    this.seq += 1
    return {
      world_version: this.worldVersion,
      room_id: this.room.id,
      room_instance_id: this.instanceId,
      seq: this.seq,
      npcs: this.walkers
        .filter((w) => w.mode.kind !== 'away')
        .map((w) => ({
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
      mode: { kind: 'dwell', until: 0, face: null },
      lastExhibit: -1,
      talk: null,
      state: 'idle',
      speed: 0,
    }
    this.choose(w)
    return w
  }

  private awayCount(): number {
    return this.walkers.filter((w) => w.mode.kind === 'away').length
  }

  private maxAway(): number {
    return Math.min(NPC_MAX_AWAY, Math.floor(this.walkers.length / 3))
  }

  /** Выбирает следующее дело; если ни одно не достижимо — коротко постоять на месте. */
  private choose(w: Walker): void {
    const roll = w.rng()
    const canLeave = this.room.doors.length > 0 && this.awayCount() < this.maxAway()
    const order: Purpose[] =
      roll < P_DOOR && canLeave ? ['door', 'exhibit'] : roll < P_DOOR + P_GUIDE && this.room.guides.length ? ['guide', 'exhibit'] : ['exhibit', 'guide']
    for (const purpose of order) {
      const go = this.plan(w, purpose)
      if (go) {
        w.mode = go
        w.state = 'walking'
        w.speed = NPC_SPEED_MPS
        return
      }
    }
    w.mode = { kind: 'dwell', until: this.clock + 2, face: null }
    w.state = 'idle'
    w.speed = 0
  }

  /** Маршрут к месту дела: точка перед картиной или гидом, либо дверь. */
  private plan(w: Walker, purpose: Purpose): Extract<Mode, { kind: 'go' }> | null {
    for (let i = 0; i < TARGET_TRIES; i++) {
      let target: Vec3 | null = null
      let face: Vec3 | null = null
      if (purpose === 'door') {
        const d = this.room.doors[Math.floor(w.rng() * this.room.doors.length)]
        // Дверь стоит вплотную к стене (запас ровно 0,3 м), поэтому точка входа — чуть глубже в зал.
        const { min, max } = this.room.bounds
        const dx = (min.x + max.x) / 2 - d.position.x
        const dz = (min.z + max.z) / 2 - d.position.z
        const len = Math.hypot(dx, dz) || 1
        target = { x: d.position.x + (dx / len) * DOOR_INSET_M, y: 0, z: d.position.z + (dz / len) * DOOR_INSET_M }
      } else if (purpose === 'guide') {
        const g = this.room.guides[Math.floor(w.rng() * this.room.guides.length)]
        target = this.stand(w, g.position, g.rotation_y, GUIDE_DIST_M)
        face = g.position
      } else if (this.room.exhibits.length) {
        let k = Math.floor(w.rng() * this.room.exhibits.length)
        if (this.room.exhibits.length > 1 && k === w.lastExhibit) k = (k + 1) % this.room.exhibits.length
        const e = this.room.exhibits[k]
        target = this.stand(w, e.position, e.rotation_y, VIEW_DIST_M)
        face = e.position
        w.lastExhibit = k
      } else {
        target = this.spots[Math.floor(w.rng() * this.spots.length)] ?? null
      }
      if (target && dist2d(target, w.pos) > 0.05 && mockValidPose(this.room, target) && mockSweep(this.room, w.pos, target)) {
        return { kind: 'go', target: { x: target.x, y: 0, z: target.z }, purpose, face }
      }
    }
    return null
  }

  /** Точка на полу перед предметом: по его нормали (rotation_y = 0 смотрит в +Z) и чуть в сторону. */
  private stand(w: Walker, at: Vec3, rotationY: number, range: [number, number]): Vec3 {
    const d = between(w.rng, range)
    const side = (w.rng() - 0.5) * 1.4
    return {
      x: at.x + Math.sin(rotationY) * d + Math.cos(rotationY) * side,
      y: 0,
      z: at.z + Math.cos(rotationY) * d - Math.sin(rotationY) * side,
    }
  }

  private walk(w: Walker, m: Extract<Mode, { kind: 'go' }>, dtS: number): void {
    w.state = 'walking'
    w.speed = NPC_SPEED_MPS
    const remaining = dist2d(w.pos, m.target)
    const move = Math.min(NPC_SPEED_MPS * dtS, remaining)
    if (remaining > 1e-9) {
      w.yaw = yawTo(w.pos, m.target)
      w.pos = { x: w.pos.x + ((m.target.x - w.pos.x) / remaining) * move, y: 0, z: w.pos.z + ((m.target.z - w.pos.z) / remaining) * move }
      w.phase = (w.phase + move * STRIDE_RAD_PER_M) % TWO_PI
    }
    if (move < remaining - 1e-9) return
    w.pos = { ...m.target }
    if (m.purpose === 'door') {
      // Вошёл в дверь: до возвращения в снимке не появляется.
      w.mode = { kind: 'away', until: this.clock + between(w.rng, AWAY_S) }
      w.state = 'idle'
      w.speed = 0
      return
    }
    const seconds = between(w.rng, m.purpose === 'guide' ? GUIDE_S : VIEW_S)
    w.mode = { kind: 'dwell', until: this.clock + seconds, face: m.face }
    w.state = 'idle'
    w.speed = 0
    if (m.face) w.yaw = yawTo(w.pos, m.face)
  }

}

/** Точки сетки, пригодные для стояния (стартовые позиции посетителей). */
function collectSpots(room: Room): Vec3[] {
  const { min, max } = room.bounds
  const all: Vec3[] = []
  for (let x = min.x; x <= max.x; x += GRID_STEP_M) {
    for (let z = min.z; z <= max.z; z += GRID_STEP_M) {
      const p = { x, y: 0, z }
      if (mockValidPose(room, p)) all.push(p)
    }
  }
  return all
}
