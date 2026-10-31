import { expect, test } from 'bun:test'
import { HAND_BASE, HAND_KICK_MS, handPose } from '../src/scene/handPose'

test('в покое фотоаппарат на базовом месте, кнопка не нажата', () => {
  const p = handPose({ timeS: 3.7, walking: 0, sinceShotMs: null })
  expect(p.x).toBeCloseTo(HAND_BASE.x)
  expect(p.y).toBeCloseTo(HAND_BASE.y)
  expect(p.z).toBeCloseTo(HAND_BASE.z)
  expect(p.pitch).toBeCloseTo(0)
  expect(p.shutter).toBe(0)
})

test('при ходьбе покачивается, но не дальше сантиметра с небольшим', () => {
  let maxDy = 0
  let maxDx = 0
  for (let t = 0; t < 2; t += 0.01) {
    const p = handPose({ timeS: t, walking: 1, sinceShotMs: null })
    maxDy = Math.max(maxDy, Math.abs(p.y - HAND_BASE.y))
    maxDx = Math.max(maxDx, Math.abs(p.x - HAND_BASE.x))
  }
  expect(maxDy).toBeGreaterThan(0.003)
  expect(maxDy).toBeLessThanOrEqual(0.012)
  expect(maxDx).toBeLessThanOrEqual(0.012)
})

test('в момент съёмки кнопка нажата, аппарат отдаёт назад и вверх', () => {
  const p = handPose({ timeS: 0, walking: 0, sinceShotMs: 30 })
  expect(p.shutter).toBeGreaterThan(0.5)
  expect(p.z).toBeGreaterThan(HAND_BASE.z) // ближе к глазам (камера смотрит в −Z)
  expect(p.pitch).toBeGreaterThan(0)
})

test('после отдачи всё возвращается на место', () => {
  const p = handPose({ timeS: 0, walking: 0, sinceShotMs: HAND_KICK_MS + 1 })
  expect(p.z).toBeCloseTo(HAND_BASE.z)
  expect(p.pitch).toBeCloseTo(0)
  expect(p.shutter).toBe(0)
})
