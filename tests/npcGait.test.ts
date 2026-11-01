import { describe, expect, test } from 'bun:test'
import { headYaw, limbSwing } from '../src/npc/gait'

describe('limbSwing', () => {
  test('ноль при speed 0', () => {
    expect(limbSwing(1.2, 0)).toEqual({ arm: 0, leg: 0 })
  })

  test('руки и ноги в противофазе', () => {
    const { arm, leg } = limbSwing(0.7, 0.6)
    expect(arm * leg).toBeLessThan(0)
  })

  test('амплитуда растёт со скоростью до 0.6 и дальше не растёт', () => {
    const a = (v: number) => Math.abs(limbSwing(Math.PI / 2, v).leg)
    expect(a(0.3)).toBeLessThan(a(0.6))
    expect(a(1.2)).toBeCloseTo(a(0.6), 9)
  })
})

describe('headYaw', () => {
  const npc = { x: 0, z: 0 }

  test('ноль вне talking', () => {
    expect(headYaw(0, 'walking', { x: 5, z: 0 }, npc)).toBe(0)
    expect(headYaw(0, 'idle', { x: 5, z: 0 }, npc)).toBe(0)
  })

  test('ноль без цели', () => {
    expect(headYaw(0, 'talking', null, npc)).toBe(0)
  })

  test('в talking голова поворачивается к цели (yaw 0 смотрит в −Z)', () => {
    // цель строго впереди — поворота нет
    expect(headYaw(0, 'talking', { x: 0, z: -3 }, npc)).toBeCloseTo(0, 9)
    // цель справа (+X) при взгляде в −Z: yaw уменьшается (forward = (−sin yaw, −cos yaw))
    expect(headYaw(0, 'talking', { x: 3, z: 0 }, npc)).toBeCloseTo(-Math.PI / 2, 9)
  })

  test('поворот ограничен ±π/2', () => {
    // цель строго позади: знак неоднозначен, модуль — предел
    expect(Math.abs(headYaw(0, 'talking', { x: 0, z: 3 }, npc))).toBeCloseTo(Math.PI / 2, 9)
    expect(Math.abs(headYaw(0, 'talking', { x: -1, z: 3 }, npc))).toBeLessThanOrEqual(Math.PI / 2 + 1e-9)
  })
})
