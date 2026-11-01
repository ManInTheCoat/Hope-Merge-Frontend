import { describe, expect, test } from 'bun:test'
import { partTransforms, type PartName } from '../src/npc/layout'

const parts = (arm = 0, leg = 0, head = 0) => {
  const m = new Map<PartName, { position: [number, number, number]; rotation: [number, number, number] }>()
  for (const p of partTransforms({ arm, leg }, head)) m.set(p.part, p)
  return m
}

describe('partTransforms', () => {
  test('шесть частей: голова, туловище, две руки, две ноги', () => {
    expect([...parts().keys()].sort()).toEqual(['armL', 'armR', 'head', 'legL', 'legR', 'torso'])
  })

  test('голова выше туловища, ноги ниже', () => {
    const p = parts()
    expect(p.get('head')!.position[1]).toBeGreaterThan(p.get('torso')!.position[1])
    expect(p.get('legL')!.position[1]).toBeLessThan(p.get('torso')!.position[1])
  })

  test('при нулевом качании руки и ноги вертикальны', () => {
    const p = parts()
    for (const k of ['armL', 'armR', 'legL', 'legR'] as const) expect(p.get(k)!.rotation).toEqual([0, 0, 0])
  })

  test('качание: левая рука и правая — в противофазе, ноги — тоже', () => {
    const p = parts(0.4, 0.5)
    expect(p.get('armL')!.rotation[0]).toBeCloseTo(0.4, 9)
    expect(p.get('armR')!.rotation[0]).toBeCloseTo(-0.4, 9)
    expect(p.get('legL')!.rotation[0]).toBeCloseTo(0.5, 9)
    expect(p.get('legR')!.rotation[0]).toBeCloseTo(-0.5, 9)
  })

  test('левая рука шагает вперёд вместе с правой ногой (противофаза рук и ног)', () => {
    const p = parts(0.4, -0.5) // limbSwing даёт arm и leg разных знаков
    expect(p.get('armL')!.rotation[0] * p.get('legL')!.rotation[0]).toBeLessThan(0)
  })

  test('поворот головы попадает в rotation.y головы', () => {
    expect(parts(0, 0, 0.7).get('head')!.rotation[1]).toBeCloseTo(0.7, 9)
  })

  test('рука и нога слева и справа симметричны по X', () => {
    const p = parts()
    expect(p.get('armL')!.position[0]).toBeCloseTo(-p.get('armR')!.position[0], 9)
    expect(p.get('legL')!.position[0]).toBeCloseTo(-p.get('legR')!.position[0], 9)
  })
})
