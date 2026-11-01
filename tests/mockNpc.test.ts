import { describe, expect, test } from 'bun:test'
import { NpcSim } from '../src/network/mock/npc'
import { mockSweep, mockValidPose } from '../src/network/mock/geometry'
import { buildWorld } from '../src/network/mock/world'
import { NPC_MAX } from '../src/npc/limits'
import type { Vec3 } from '../src/network/contract'
import type { SundayNPC } from '../src/network/sunday'

const world = await buildWorld(async () => new Blob([new Uint8Array(64)], { type: 'image/jpeg' }))
const room = [...world.rooms.values()][0].room
const sim = (count = NPC_MAX) => new NpcSim(room, room.world_version, count, 'inst-1')
const at = (x: number, z: number): Vec3 => ({ x, y: 0, z })
const DT = 0.2
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z)
const yawTo = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.atan2(-(b.x - a.x), -(b.z - a.z))
const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
const byId = (npcs: SundayNPC[]) => new Map(npcs.map((n) => [n.npc_id, n]))
const ids = (n: number) => Array.from({ length: n }, (_, i) => `npc_${String(i).padStart(2, '0')}`)

/** Прогоняет симуляцию без игроков и отдаёт снимок после каждого тика. */
function run(s: NpcSim, seconds: number): SundayNPC[][] {
  const frames: SundayNPC[][] = []
  for (let i = 0; i < seconds / DT; i++) {
    s.step(DT, i * 200, [])
    frames.push(s.snapshot().npcs)
  }
  return frames
}

describe('NpcSim', () => {
  test('максимум посетителей — 10: NPC_MAX и ограничение setCount/конструктора', () => {
    expect(NPC_MAX).toBe(10)
    expect(sim(40).snapshot().npcs).toHaveLength(10)
    const s = sim(3)
    s.setCount(40)
    expect(s.snapshot().npcs).toHaveLength(10)
  })

  test('создаёт npc_00..npc_{count−1}', () => {
    const s = sim(10).snapshot()
    expect(s.npcs.map((n) => n.npc_id)).toEqual(ids(10))
    expect(s.room_id).toBe(room.id)
    expect(s.world_version).toBe(room.world_version)
    expect(s.room_instance_id).toBe('inst-1')
  })

  test('позиции всегда валидны, шаги проходят mockSweep (5 мин, включая выходы через дверь)', () => {
    const s = sim()
    let prev = byId(s.snapshot().npcs)
    for (const frame of run(s, 300)) {
      const cur = byId(frame)
      for (const n of frame) {
        expect(mockValidPose(room, n.position)).toBe(true)
        const p = prev.get(n.npc_id)
        if (p) expect(mockSweep(room, p.position, n.position)).toBe(true)
      }
      prev = cur
    }
  })

  test('два экземпляра с теми же входами дают те же траектории', () => {
    const a = sim()
    const b = sim()
    for (let i = 0; i < 300; i++) {
      a.step(DT, i * 200, [])
      b.step(DT, i * 200, [])
    }
    expect(a.snapshot().npcs).toEqual(b.snapshot().npcs)
  })

  test('посетитель останавливается у картины и смотрит на неё', () => {
    const frames = run(sim(), 300)
    const watching = frames.flat().filter((n) => {
      if (n.state !== 'idle' || n.speed_mps !== 0) return false
      const ex = room.exhibits.find((e) => dist(n.position, e.position) < 2.2)
      return !!ex && angDiff(n.yaw, yawTo(n.position, ex.position)) < 0.05
    })
    expect(watching.length).toBeGreaterThan(0)
  })

  test('стоит у картины несколько секунд подряд, а не уходит сразу', () => {
    const frames = run(sim(), 300)
    let best = 0
    for (const id of ids(NPC_MAX)) {
      let streak = 0
      for (const f of frames) {
        const n = f.find((x) => x.npc_id === id)
        const watching = n && n.speed_mps === 0 && room.exhibits.some((e) => dist(n.position, e.position) < 2.2)
        streak = watching ? streak + 1 : 0
        best = Math.max(best, streak)
      }
    }
    expect(best * DT).toBeGreaterThanOrEqual(4)
  })

  test('посетитель подходит к гиду и смотрит на него', () => {
    const guide = room.guides[0]
    const frames = run(sim(), 600)
    const talking = frames.flat().filter(
      (n) => n.speed_mps === 0 && dist(n.position, guide.position) < 2 && angDiff(n.yaw, yawTo(n.position, guide.position)) < 0.05,
    )
    expect(talking.length).toBeGreaterThan(0)
  })

  test('посетитель уходит в дверь и возвращается через неё; одновременно отсутствуют не больше трёх', () => {
    const door = room.doors[0]
    const frames = run(sim(), 600)
    let minPresent = NPC_MAX
    let left = false
    let returned = false
    const seen = new Map<string, SundayNPC>()
    const gone = new Set<string>()
    for (const f of frames) {
      minPresent = Math.min(minPresent, f.length)
      expect(f.length).toBeGreaterThanOrEqual(NPC_MAX - 3)
      const now = byId(f)
      for (const [id, last] of seen) {
        if (!now.has(id) && !gone.has(id)) {
          gone.add(id)
          if (dist(last.position, door.position) < 1) left = true
        }
      }
      for (const n of f) {
        if (gone.has(n.npc_id)) {
          gone.delete(n.npc_id)
          if (dist(n.position, door.position) < 1) returned = true
        }
        seen.set(n.npc_id, n)
      }
    }
    expect(left).toBe(true)
    expect(returned).toBe(true)
    expect(minPresent).toBeLessThan(NPC_MAX)
  })

  test('игрок на 0.9 м останавливает NPC (idle), на 1.1 м — нет', () => {
    for (const [d, expected] of [[0.9, 'idle'], [1.1, 'walking']] as const) {
      const s = sim(1)
      const n0 = s.snapshot().npcs[0]
      const player = { user_id: 'u1', position: at(n0.position.x + d, n0.position.z) }
      s.step(DT, 0, [player])
      const n1 = s.snapshot().npcs[0]
      expect(n1.state).toBe(expected)
      if (expected === 'idle') {
        expect(n1.position).toEqual(n0.position)
        expect(n1.speed_mps).toBe(0)
      } else {
        expect(n1.speed_mps).toBe(0.6)
      }
    }
  })

  test('chat на 2.9 м вводит talking и поворачивает к игроку, на 3.1 м — нет', () => {
    for (const [d, talks] of [[2.9, true], [3.1, false]] as const) {
      const s = sim(1)
      const n0 = s.snapshot().npcs[0]
      const pos = at(n0.position.x + d, n0.position.z)
      s.chat('u1', pos, 1000)
      s.step(DT, 1000, [{ user_id: 'u1', position: pos }])
      const n = s.snapshot().npcs[0]
      expect(n.state === 'talking').toBe(talks)
      if (talks) {
        expect(n.position).toEqual(n0.position)
        expect(n.speed_mps).toBe(0)
        // направление на игрока (+X): yaw = atan2(−dx, −dz) = −π/2
        expect(n.yaw).toBeCloseTo(-Math.PI / 2, 5)
      }
    }
  })

  test('через 3 с без повтора разговор заканчивается', () => {
    const s = sim(1)
    const n0 = s.snapshot().npcs[0]
    const pos = at(n0.position.x + 2.5, n0.position.z)
    s.chat('u1', pos, 1000)
    s.step(DT, 1000, [{ user_id: 'u1', position: pos }])
    s.step(DT, 3999, [{ user_id: 'u1', position: pos }])
    expect(s.snapshot().npcs[0].state).toBe('talking')
    s.step(DT, 4001, [{ user_id: 'u1', position: pos }])
    expect(s.snapshot().npcs[0].state).not.toBe('talking')
  })

  test('повторное chat продлевает разговор на 3 с', () => {
    const s = sim(1)
    const n0 = s.snapshot().npcs[0]
    const pos = at(n0.position.x + 2.5, n0.position.z)
    const players = [{ user_id: 'u1', position: pos }]
    s.chat('u1', pos, 1000)
    s.step(DT, 1000, players)
    s.chat('u1', pos, 3000)
    s.step(DT, 5500, players)
    expect(s.snapshot().npcs[0].state).toBe('talking')
    s.step(DT, 6001, players)
    expect(s.snapshot().npcs[0].state).not.toBe('talking')
  })

  test('последний отправитель; при равном времени — минимальный user_id', () => {
    const s = sim(1)
    const n0 = s.snapshot().npcs[0]
    const east = at(n0.position.x + 2, n0.position.z)
    const west = at(n0.position.x - 2, n0.position.z)
    const players = [
      { user_id: 'u1', position: west },
      { user_id: 'u2', position: east },
      { user_id: 'u3', position: east },
    ]
    s.chat('u2', east, 1000)
    s.chat('u1', west, 1000)
    s.step(DT, 1000, players)
    expect(s.snapshot().npcs[0].yaw).toBeCloseTo(Math.PI / 2, 5) // u1 на западе
    s.chat('u3', east, 2000)
    s.step(DT, 2000, players)
    expect(s.snapshot().npcs[0].yaw).toBeCloseTo(-Math.PI / 2, 5) // u3 новее
  })

  test('setCount уменьшает с конца, 0 даёт []', () => {
    const s = sim(10)
    s.setCount(4)
    expect(s.snapshot().npcs.map((n) => n.npc_id)).toEqual(ids(4))
    s.setCount(0)
    expect(s.snapshot().npcs).toEqual([])
  })

  test('seq растёт с 1', () => {
    const s = sim(3)
    expect(s.snapshot().seq).toBe(1)
    expect(s.snapshot().seq).toBe(2)
  })

  test('phase в [0, 2π), speed 0.6 у идущего и 0 у стоящего', () => {
    const s = sim()
    for (const frame of run(s, 60)) {
      for (const n of frame) {
        expect(n.phase).toBeGreaterThanOrEqual(0)
        expect(n.phase).toBeLessThan(2 * Math.PI)
        expect(n.speed_mps === 0.6 || n.speed_mps === 0).toBe(true)
        expect(n.speed_mps === 0.6).toBe(n.state === 'walking')
      }
    }
  })
})
