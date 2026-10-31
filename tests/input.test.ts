import { expect, test } from 'bun:test'
import { MoveKeys, moveVector } from '../src/scene/input'

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
