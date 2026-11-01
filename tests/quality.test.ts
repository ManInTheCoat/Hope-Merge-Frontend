import { expect, test } from 'bun:test'
import { QualityGovernor } from '../src/scene/quality'

const opts = { min: 0.6, max: 1.5, step: 0.15, lowFps: 45, highFps: 58, windowS: 3 }
const run = (g: QualityGovernor, fps: number, seconds: number) => {
  let out: number | null = null
  for (let t = 0; t < seconds * fps; t++) out = g.sample(1 / fps) ?? out
  return out
}

test('QualityGovernor: понижает при низком FPS, не ниже min, повышает при запасе', () => {
  const g = new QualityGovernor(opts)
  expect(run(g, 30, 3)).toBeCloseTo(1.35)
  for (let i = 0; i < 10; i++) run(g, 30, 3)
  expect(g.ratio).toBeCloseTo(0.6)
  expect(run(g, 60, 3)).toBeCloseTo(0.75)
})

test('QualityGovernor: короткая просадка ничего не меняет', () => {
  const g = new QualityGovernor(opts)
  expect(run(g, 30, 1)).toBeNull()
})
