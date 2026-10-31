import { expect, test } from 'bun:test'
import { MoveHistory } from '../src/world/moveHistory'

test('принятый сервером шаг не требует коррекции', () => {
  const h = new MoveHistory()
  h.record(1, { x: 0, z: 0 })
  h.record(2, { x: 0, z: -0.4 })
  expect(h.reconcile(2, { x: 0, z: -0.4 })).toBeNull()
})

test('отклонённый шаг возвращает игрока на серверную позицию', () => {
  const h = new MoveHistory()
  h.record(1, { x: 0, z: 0 })
  h.record(2, { x: 0, z: -0.4 })
  expect(h.reconcile(2, { x: 0, z: 0 })).toEqual({ x: 0, z: 0 })
})

test('после коррекции старые записи не используются', () => {
  const h = new MoveHistory()
  h.record(1, { x: 0, z: 0 })
  h.record(2, { x: 0, z: -0.4 })
  h.record(3, { x: 0, z: -0.8 })
  h.reconcile(2, { x: 0, z: 0 })
  expect(h.reconcile(3, { x: 0, z: 0 })).toBeNull()
  expect(h.size).toBe(0)
})

test('неизвестный ack_seq игнорируется', () => {
  const h = new MoveHistory()
  h.record(5, { x: 1, z: 1 })
  expect(h.reconcile(4, { x: 9, z: 9 })).toBeNull()
})

test('подтверждённые записи удаляются, неподтверждённые остаются', () => {
  const h = new MoveHistory()
  for (let i = 1; i <= 5; i++) h.record(i, { x: i, z: 0 })
  h.reconcile(3, { x: 3, z: 0 })
  expect(h.size).toBe(2)
})

test('погрешность в миллиметр — не отклонение', () => {
  const h = new MoveHistory()
  h.record(1, { x: 1, z: 1 })
  expect(h.reconcile(1, { x: 1.0005, z: 1 })).toBeNull()
})
