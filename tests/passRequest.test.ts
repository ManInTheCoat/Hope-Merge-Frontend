import { describe, expect, test } from 'bun:test'
import { PASS_COOLDOWN_MS, PASS_PHRASES, PASS_SHOW_MS, PassRequest } from '../src/npc/passRequest'
import type { NpcPose } from '../src/npc/npcBuffer'

const npc = (over: Partial<NpcPose> = {}): NpcPose => ({
  id: 'npc_00',
  x: 0,
  z: 0,
  yaw: 0, // смотрит в −Z
  state: 'idle',
  speed_mps: 0,
  phase: 0,
  ...over,
})

describe('PassRequest', () => {
  test('есть 3–5 фраз, первая — «Простите, можно пройти?»', () => {
    expect(PASS_PHRASES.length).toBeGreaterThanOrEqual(3)
    expect(PASS_PHRASES.length).toBeLessThanOrEqual(5)
    expect(PASS_PHRASES[0]).toBe('Простите, можно пройти?')
  })

  test('idle, игрок в 0.8 м впереди — реплика', () => {
    const r = new PassRequest()
    expect(r.update(0, { x: 0, z: -0.8 }, [npc()])).not.toBeNull()
  })

  test('игрок сзади — null', () => {
    expect(new PassRequest().update(0, { x: 0, z: 0.8 }, [npc()])).toBeNull()
  })

  test('walking — null', () => {
    expect(new PassRequest().update(0, { x: 0, z: -0.8 }, [npc({ state: 'walking' })])).toBeNull()
  })

  test('игрок дальше 1 м — null', () => {
    expect(new PassRequest().update(0, { x: 0, z: -1.2 }, [npc()])).toBeNull()
  })

  test('игрок null — null', () => {
    expect(new PassRequest().update(0, null, [npc()])).toBeNull()
  })

  test('угол ровно за конусом 60° — null, внутри — реплика', () => {
    const d = 0.8
    const at = (deg: number) => ({ x: -Math.sin((deg * Math.PI) / 180) * d, z: -Math.cos((deg * Math.PI) / 180) * d })
    expect(new PassRequest().update(0, at(70), [npc()])).toBeNull()
    expect(new PassRequest().update(0, at(50), [npc()])).not.toBeNull()
  })

  test('показ гаснет через 2.5 с', () => {
    const r = new PassRequest()
    const p = { x: 0, z: -0.8 }
    expect(r.update(0, p, [npc()])).not.toBeNull()
    expect(r.update(PASS_SHOW_MS - 1, p, [npc()])).not.toBeNull()
    expect(r.update(PASS_SHOW_MS, p, [npc()])).toBeNull()
  })

  test('до 6 с после первого показа нового не будет, после — будет', () => {
    const r = new PassRequest()
    const p = { x: 0, z: -0.8 }
    r.update(0, p, [npc()])
    expect(r.update(PASS_COOLDOWN_MS - 1, p, [npc()])).toBeNull()
    expect(r.update(PASS_COOLDOWN_MS, p, [npc()])).not.toBeNull()
  })

  test('фраза детерминирована по npc_id', () => {
    const p = { x: 0, z: -0.8 }
    const a = new PassRequest().update(0, p, [npc({ id: 'npc_07' })])
    const b = new PassRequest().update(5, p, [npc({ id: 'npc_07' })])
    expect(a).toBe(b)
    expect(PASS_PHRASES).toContain(a!)
  })

  test('выбирается ближайший из подходящих', () => {
    const r = new PassRequest()
    const far = npc({ id: 'npc_01', x: 0, z: -0.2 }) // игрок в 0.6 м от него
    const near = npc({ id: 'npc_02', x: 0, z: -0.5 }) // игрок в 0.3 м
    const a = r.update(0, { x: 0, z: -0.8 }, [far, near])
    const b = new PassRequest().update(0, { x: 0, z: -0.8 }, [near])
    expect(a).toBe(b)
  })
})
