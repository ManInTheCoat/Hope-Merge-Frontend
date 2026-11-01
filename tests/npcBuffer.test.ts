import { describe, expect, test } from 'bun:test'
import { NPC_RENDER_DELAY_MS, NpcBuffers } from '../src/npc/npcBuffer'
import type { SundayNPC } from '../src/network/sunday'

const npc = (id: string, x: number, z: number, over: Partial<SundayNPC> = {}): SundayNPC => ({
  npc_id: id,
  position: { x, y: 0, z },
  yaw: 0,
  state: 'walking',
  speed_mps: 0.6,
  phase: 1,
  ...over,
})

describe('NpcBuffers', () => {
  test('задержка отрисовки 200 мс', () => {
    expect(NPC_RENDER_DELAY_MS).toBe(200)
  })

  test('середина между двумя снимками даёт полпути', () => {
    const b = new NpcBuffers()
    b.apply([npc('npc_00', 0, 0)], 1000)
    b.apply([npc('npc_00', 1, 0)], 1200)
    const [p] = b.sample(1300) // момент отрисовки 1100
    expect(p.x).toBeCloseTo(0.5, 5)
  })

  test('yaw через ±π идёт по короткой дуге', () => {
    const b = new NpcBuffers()
    b.apply([npc('npc_00', 0, 0, { yaw: 3.0 })], 1000)
    b.apply([npc('npc_00', 0, 0, { yaw: -3.0 })], 1200)
    const [p] = b.sample(1300)
    expect(Math.abs(p.yaw)).toBeGreaterThan(3.1)
  })

  test('один снимок: поза без NaN', () => {
    const b = new NpcBuffers()
    b.apply([npc('npc_00', 2, 3)], 1000)
    const [p] = b.sample(5000)
    expect(p.x).toBe(2)
    expect(p.z).toBe(3)
    expect(Number.isNaN(p.yaw)).toBe(false)
  })

  test('два снимка в одну миллисекунду: без NaN', () => {
    const b = new NpcBuffers()
    b.apply([npc('npc_00', 0, 0)], 1000)
    b.apply([npc('npc_00', 1, 0)], 1000)
    for (const t of [1000, 1100, 1200, 1300]) {
      const [p] = b.sample(t)
      expect(Number.isFinite(p.x)).toBe(true)
    }
  })

  test('NPC, пропавший из снимка, исчезает', () => {
    const b = new NpcBuffers()
    b.apply([npc('npc_00', 0, 0), npc('npc_01', 1, 1)], 1000)
    b.apply([npc('npc_01', 1, 1)], 1200)
    expect(b.sample(1500).map((p) => p.id)).toEqual(['npc_01'])
  })

  test('пустой список очищает всех', () => {
    const b = new NpcBuffers()
    b.apply([npc('npc_00', 0, 0)], 1000)
    b.apply([], 1200)
    expect(b.sample(1500)).toEqual([])
  })

  test('скачок больше 2 м ставит позицию сразу', () => {
    const b = new NpcBuffers()
    b.apply([npc('npc_00', 0, 0)], 1000)
    b.apply([npc('npc_00', 10, 0)], 1200)
    const [p] = b.sample(1300)
    expect(p.x).toBe(10)
  })

  test('результат отсортирован по id; state, speed и phase берутся из снимка', () => {
    const b = new NpcBuffers()
    b.apply([npc('npc_02', 0, 0), npc('npc_01', 0, 0, { state: 'idle', speed_mps: 0, phase: 2 })], 1000)
    const ps = b.sample(1300)
    expect(ps.map((p) => p.id)).toEqual(['npc_01', 'npc_02'])
    expect(ps[0]).toMatchObject({ state: 'idle', speed_mps: 0, phase: 2 })
  })
})
