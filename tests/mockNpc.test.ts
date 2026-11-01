import { describe, expect, test } from 'bun:test'
import { NpcSim } from '../src/network/mock/npc'
import { mockSweep, mockValidPose } from '../src/network/mock/geometry'
import { buildWorld } from '../src/network/mock/world'
import type { Vec3 } from '../src/network/contract'

const world = await buildWorld(async () => new Blob([new Uint8Array(64)], { type: 'image/jpeg' }))
const room = [...world.rooms.values()][0].room
const sim = (count = 40) => new NpcSim(room, room.world_version, count, 'inst-1')
const at = (x: number, z: number): Vec3 => ({ x, y: 0, z })
const DT = 0.2

describe('NpcSim', () => {
  test('создаёт npc_00..npc_{count−1}', () => {
    const s = sim(40).snapshot()
    expect(s.npcs.map((n) => n.npc_id)).toEqual(Array.from({ length: 40 }, (_, i) => `npc_${String(i).padStart(2, '0')}`))
    expect(s.room_id).toBe(room.id)
    expect(s.world_version).toBe(room.world_version)
    expect(s.room_instance_id).toBe('inst-1')
  })

  test('позиции всегда валидны, шаги проходят mockSweep (60 с)', () => {
    const s = sim(40)
    let prev = s.snapshot().npcs
    for (let i = 0; i < 300; i++) {
      s.step(DT, i * 200, [])
      const cur = s.snapshot().npcs
      cur.forEach((n, k) => {
        expect(mockValidPose(room, n.position)).toBe(true)
        expect(mockSweep(room, prev[k].position, n.position)).toBe(true)
      })
      prev = cur
    }
  })

  test('два экземпляра с теми же входами дают те же траектории', () => {
    const a = sim(10)
    const b = sim(10)
    for (let i = 0; i < 50; i++) {
      a.step(DT, i * 200, [])
      b.step(DT, i * 200, [])
    }
    const strip = (x: ReturnType<NpcSim['snapshot']>) => x.npcs
    expect(strip(a.snapshot())).toEqual(strip(b.snapshot()))
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

  test('через 3 с без повтора возвращается walking', () => {
    const s = sim(1)
    const n0 = s.snapshot().npcs[0]
    const pos = at(n0.position.x + 2.5, n0.position.z)
    s.chat('u1', pos, 1000)
    s.step(DT, 1000, [{ user_id: 'u1', position: pos }])
    s.step(DT, 3999, [{ user_id: 'u1', position: pos }])
    expect(s.snapshot().npcs[0].state).toBe('talking')
    s.step(DT, 4001, [{ user_id: 'u1', position: pos }])
    expect(s.snapshot().npcs[0].state).toBe('walking')
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
    expect(s.snapshot().npcs[0].state).toBe('walking')
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
    const s = sim(40)
    s.setCount(10)
    expect(s.snapshot().npcs.map((n) => n.npc_id)).toEqual(Array.from({ length: 10 }, (_, i) => `npc_0${i}`))
    s.setCount(0)
    expect(s.snapshot().npcs).toEqual([])
  })

  test('seq растёт с 1', () => {
    const s = sim(3)
    expect(s.snapshot().seq).toBe(1)
    expect(s.snapshot().seq).toBe(2)
  })

  test('phase в [0, 2π), speed 0.6 у идущего', () => {
    const s = sim(40)
    for (let i = 0; i < 100; i++) s.step(DT, i * 200, [])
    for (const n of s.snapshot().npcs) {
      expect(n.phase).toBeGreaterThanOrEqual(0)
      expect(n.phase).toBeLessThan(2 * Math.PI)
      expect(n.speed_mps === 0.6 || n.speed_mps === 0).toBe(true)
    }
  })
})
