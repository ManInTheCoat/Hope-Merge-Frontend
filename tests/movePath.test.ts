import { expect, test } from 'bun:test'
import { segmentClear, type Aabb, type MoveWorld } from '../src/scene/collision'
import { MovePath } from '../src/world/movePath'

const R = 0.3
const box: Aabb = { minX: 0, maxX: 1, minY: 0, maxY: 3, minZ: 0, maxZ: 1 }
const open: MoveWorld = { colliders: [], bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 } }
const withBox: MoveWorld = { colliders: [box], bounds: open.bounds }
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z)

test('прямой путь без препятствий: отправляется конечная точка', () => {
  const path = new MovePath()
  path.reset({ x: 0, z: 0 })
  for (let i = 1; i <= 6; i++) path.record({ x: 0, z: -0.06 * i })
  const p = path.take(open, R, 0.36)!
  expect(p.z).toBeCloseTo(-0.36, 9)
  expect(path.pending).toBe(false)
})

test('обход угла по дуге: сначала промежуточная точка с чистым отрезком, затем конечная', () => {
  const path = new MovePath()
  const start = { x: -0.31, z: 0.5 }
  path.reset(start)
  // Дуга радиусом 0,31 вокруг угла (0,0): от левой грани к нижней.
  const arc = Array.from({ length: 10 }, (_, i) => {
    const a = Math.PI - ((i + 1) / 10) * (Math.PI / 2)
    return { x: 0.31 * Math.cos(a), z: -0.31 * Math.sin(a) }
  })
  const pts = [{ x: -0.31, z: 0 }, ...arc]
  pts.forEach((p) => path.record(p))
  const end = pts[pts.length - 1]
  expect(segmentClear(start, end, withBox, R)).toBe(false) // прямая срезала бы угол

  const first = path.take(withBox, R, 10)!
  expect(dist(first, end)).toBeGreaterThan(1e-6)
  expect(segmentClear(start, first, withBox, R)).toBe(true)
  expect(path.pending).toBe(true)

  let last = first
  let guard = 0
  while (path.pending && guard++ < 20) {
    const next = path.take(withBox, R, 10)!
    expect(segmentClear(last, next, withBox, R)).toBe(true)
    last = next
  }
  expect(dist(last, end)).toBeLessThan(1e-9)
})

test('шаг длиннее разрешённого дробится: каждая отправка не дальше maxStep', () => {
  const path = new MovePath()
  path.reset({ x: 0, z: 0 })
  path.record({ x: 0, z: -1 }) // вкладка была в фоне: один прыжок на метр
  let last = { x: 0, z: 0 }
  let guard = 0
  while (path.pending && guard++ < 10) {
    const p = path.take(open, R, 0.36)!
    expect(dist(last, p)).toBeLessThanOrEqual(0.36 + 1e-9)
    last = p
  }
  expect(last.z).toBeCloseTo(-1, 9)
})

test('без движения отправлять нечего', () => {
  const path = new MovePath()
  path.reset({ x: 1, z: 1 })
  path.record({ x: 1, z: 1 })
  expect(path.take(open, R, 0.36)).toBeNull()
  expect(path.pending).toBe(false)
})

import { moveCylinder } from '../src/scene/collision'

/**
 * Игрок прижимается к блоку (давит в +X, идя на −Z), затем целится в точку сразу за углом (0, 0):
 * траектория плотно огибает угол. Отправка раз в 100 мс, как в game.ts.
 */
function corner(fps: number, ang: number): { sends: number; bad: number } {
  const world: MoveWorld = { colliders: [{ minX: 0, maxX: 1, minY: 0, maxY: 3, minZ: 0, maxZ: 1 }], bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 } }
  let pos = { x: -0.301, z: 0.5 }
  const path = new MovePath()
  path.reset(pos)
  let sent = path.sent
  let bad = 0
  let sends = 0
  let t = 0
  let lastSend = 0
  const dt = 1 / fps
  for (let f = 0; f < fps * 1.5; f++) {
    t += dt * 1000
    let dx = 0.5 - pos.x
    let dz = -0.01 - ang / 100 - pos.z
    if (pos.z > 0.05) {
      dx = 0.3
      dz = -1
    }
    const n = Math.hypot(dx, dz)
    pos = moveCylinder(pos, { x: (dx / n) * 3.6 * dt, z: (dz / n) * 3.6 * dt }, world, R)
    path.record(pos)
    if (t - lastSend >= 100 - 1e-9) {
      const el = t - lastSend
      lastSend = t
      const q = path.take(world, R, 3.6 * Math.min(el / 1000, 0.25)) ?? path.sent
      sends++
      if (!segmentClear(sent, q, world, R)) bad++
      sent = q
    }
  }
  return { sends, bad }
}

test('плотный обход угла на реальной коллизии: ни один отправленный отрезок не срезает угол', () => {
  for (const fps of [30, 60, 120]) {
    for (const ang of [20, 45, 70]) {
      const { sends, bad } = corner(fps, ang)
      expect(sends).toBeGreaterThan(10)
      expect([fps, ang, bad]).toEqual([fps, ang, 0])
    }
  }
})

import { moveSendBudget } from '../src/scene/input'

test('на бегу отставание отправленной позиции не копится: догоняет при дрожании кадров', () => {
  const world: MoveWorld = { colliders: [], bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 } }
  const path = new MovePath()
  let pos = { x: 0, z: 0 }
  path.reset(pos)
  let t = 0
  let nextSend = 107 // таймер отправки не совпадает с кадрами
  let lastSend = 7
  // 3 секунды бега 3,6 м/с; кадры 13–20 мс вразнобой
  const frames = [16, 20, 13, 17, 19, 14, 16, 18]
  for (let i = 0; i < 180; i++) {
    const dt = frames[i % frames.length]
    // Отправки, сработавшие до этого кадра, видят только уже записанные точки.
    while (nextSend <= t + dt) {
      path.take(world, R, moveSendBudget(4, nextSend - lastSend))
      lastSend = nextSend
      nextSend += 100
    }
    t += dt
    pos = { x: 0, z: pos.z - 3.6 * (dt / 1000) }
    path.record(pos)
  }
  // Отправленная позиция отстаёт на неотправленный хвост (< интервала), а не копит отставание.
  const unsent = 3.6 * ((t - lastSend) / 1000)
  expect(Math.abs(path.sent.z - pos.z)).toBeLessThan(unsent + 0.08)
})
