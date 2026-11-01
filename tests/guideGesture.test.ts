import { describe, expect, test } from 'bun:test'
import { GESTURE_BLEND_S, GestureTracker, gestureWeight } from '../src/scene/guideGesture'

describe('GestureTracker', () => {
  test('start → активен, stop → нет', () => {
    const t = new GestureTracker()
    t.start('guide_a', 'g1')
    expect(t.active('guide_a')).toBe(true)
    t.stop('g1')
    expect(t.active('guide_a')).toBe(false)
  })

  test('два start одного гида, один stop — ещё активен', () => {
    const t = new GestureTracker()
    t.start('guide_a', 'g1')
    t.start('guide_a', 'g2')
    t.stop('g1')
    expect(t.active('guide_a')).toBe(true)
    t.stop('g2')
    expect(t.active('guide_a')).toBe(false)
  })

  test('stop неизвестной генерации ничего не ломает и не гасит чужой жест', () => {
    const t = new GestureTracker()
    t.start('guide_a', 'g1')
    t.stop('unknown')
    expect(t.active('guide_a')).toBe(true)
  })

  test('жесты разных гидов независимы', () => {
    const t = new GestureTracker()
    t.start('guide_a', 'g1')
    expect(t.active('guide_b')).toBe(false)
  })

  test('clear сбрасывает всё', () => {
    const t = new GestureTracker()
    t.start('guide_a', 'g1')
    t.clear()
    expect(t.active('guide_a')).toBe(false)
  })

  test('start с тем же generationId не плодит дубли: один stop выключает', () => {
    const t = new GestureTracker()
    t.start('guide_a', 'g1')
    t.start('guide_a', 'g1')
    t.stop('g1')
    expect(t.active('guide_a')).toBe(false)
  })
})

describe('gestureWeight', () => {
  test('за время смешивания доходит до 1 и не выходит за [0, 1]', () => {
    let w = 0
    for (let i = 0; i < 100; i++) w = gestureWeight(w, true, GESTURE_BLEND_S / 10)
    expect(w).toBe(1)
    expect(gestureWeight(0.95, true, 10)).toBe(1)
  })

  test('убывает при active = false и не уходит ниже 0', () => {
    expect(gestureWeight(1, false, GESTURE_BLEND_S / 2)).toBeCloseTo(0.5, 9)
    expect(gestureWeight(0.1, false, 10)).toBe(0)
  })

  test('нулевой dt не меняет вес', () => {
    expect(gestureWeight(0.4, true, 0)).toBe(0.4)
  })
})
