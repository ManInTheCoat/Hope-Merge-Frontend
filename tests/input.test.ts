import { expect, test } from 'bun:test'
import { CLIENT_SPEED_FACTOR, MoveKeys, moveVector, shouldSendMove, wrapAngle } from '../src/scene/input'

const none = { forward: false, back: false, left: false, right: false }
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9)

test('W при yaw=0 идёт к −Z', () => {
  const v = moveVector({ ...none, forward: true }, 0, 4, 0.25)
  near(v.x, 0)
  near(v.z, -1)
})

test('D при yaw=0 идёт к +X', () => {
  const v = moveVector({ ...none, right: true }, 0, 4, 0.25)
  near(v.x, 1)
  near(v.z, 0)
})

test('при yaw=π/2 вперёд — к −X', () => {
  const v = moveVector({ ...none, forward: true }, Math.PI / 2, 4, 0.25)
  near(v.x, -1)
  near(v.z, 0)
})

test('диагональ не быстрее прямой', () => {
  const v = moveVector({ ...none, forward: true, right: true }, 0, 4, 0.25)
  near(Math.hypot(v.x, v.z), 1)
})

test('противоположные клавиши гасят друг друга', () => {
  const v = moveVector({ ...none, forward: true, back: true }, 0, 4, 0.25)
  near(v.x, 0)
  near(v.z, 0)
})

test('MoveKeys отслеживает нажатия WASD', () => {
  const k = new MoveKeys()
  k.onKeyDown('KeyW')
  k.onKeyDown('KeyD')
  expect(k.state).toEqual({ forward: true, back: false, left: false, right: true })
  k.onKeyUp('KeyW')
  expect(k.state.forward).toBe(false)
})

test('clear сбрасывает зажатые клавиши', () => {
  const k = new MoveKeys()
  k.onKeyDown('KeyW')
  k.onKeyDown('KeyA')
  k.clear()
  expect(k.state).toEqual(none)
})

test('wrapAngle приводит yaw к диапазону [−π, π)', () => {
  near(wrapAngle(0), 0)
  near(wrapAngle(Math.PI * 1.5), -Math.PI / 2)
  near(wrapAngle(-Math.PI * 2.5), -Math.PI / 2)
  near(wrapAngle(Math.PI), -Math.PI)
  for (const a of [10, -10, 100, -100, 3.2]) {
    const w = wrapAngle(a)
    expect(w).toBeGreaterThanOrEqual(-Math.PI)
    expect(w).toBeLessThan(Math.PI)
  }
})

test('клиент ходит медленнее максимума сервера', () => {
  expect(CLIENT_SPEED_FACTOR).toBeLessThan(1)
  expect(CLIENT_SPEED_FACTOR).toBeGreaterThan(0.8)
})

test('shouldSendMove не шлёт move чаще минимального зазора', () => {
  expect(shouldSendMove(1000, 1030, 50)).toBe(false)
  expect(shouldSendMove(1000, 1050, 50)).toBe(true)
  expect(shouldSendMove(null, 1000, 50)).toBe(true)
})
