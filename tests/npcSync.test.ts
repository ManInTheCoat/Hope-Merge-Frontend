import { describe, expect, test } from 'bun:test'
import { NpcSync } from '../src/npc/npcSync'
import type { SundayNPCState } from '../src/network/sunday'

const snap = (over: Partial<SundayNPCState> = {}): SundayNPCState => ({
  world_version: 'w1',
  room_id: 'r1',
  room_instance_id: 'i1',
  seq: 1,
  npcs: [],
  ...over,
})

describe('NpcSync', () => {
  test('принимает первый снимок', () => {
    const s = new NpcSync('r1', 'w1')
    expect(s.accept(snap())).toBe(true)
    expect(s.current?.seq).toBe(1)
  })

  test('отбрасывает seq не больше принятого в той же instance', () => {
    const s = new NpcSync('r1', 'w1')
    s.accept(snap({ seq: 5 }))
    expect(s.accept(snap({ seq: 5 }))).toBe(false)
    expect(s.accept(snap({ seq: 4 }))).toBe(false)
    expect(s.accept(snap({ seq: 6 }))).toBe(true)
  })

  test('принимает новую room_instance_id с seq 1', () => {
    const s = new NpcSync('r1', 'w1')
    s.accept(snap({ seq: 9 }))
    expect(s.accept(snap({ room_instance_id: 'i2', seq: 1 }))).toBe(true)
  })

  test('отбрасывает чужой room_id', () => {
    expect(new NpcSync('r1', 'w1').accept(snap({ room_id: 'r2' }))).toBe(false)
  })

  test('отбрасывает чужую world_version', () => {
    expect(new NpcSync('r1', 'w1').accept(snap({ world_version: 'w2' }))).toBe(false)
  })

  test('enter сбрасывает состояние: прежняя instance и seq забыты', () => {
    const s = new NpcSync('r1', 'w1')
    s.accept(snap({ seq: 9 }))
    s.enter('r2')
    expect(s.current).toBeNull()
    expect(s.accept(snap({ room_id: 'r1', seq: 10 }))).toBe(false)
    expect(s.accept(snap({ room_id: 'r2', room_instance_id: 'i1', seq: 1 }))).toBe(true)
  })

  test('принимает пустой список npcs', () => {
    const s = new NpcSync('r1', 'w1')
    expect(s.accept(snap({ npcs: [] }))).toBe(true)
    expect(s.current?.npcs).toEqual([])
  })

  test('отбрасывает снимок с неверным seq', () => {
    const s = new NpcSync('r1', 'w1')
    expect(s.accept(snap({ seq: 0 }))).toBe(false)
    expect(s.accept(snap({ seq: 1.5 }))).toBe(false)
  })
})
