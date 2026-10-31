import { expect, test } from 'bun:test'
import type { Player } from '../src/network/contract'
import { PlayerRegistry } from '../src/players/registry'

const p = (id: string, room = 'r1', x = 0, color = '#112233'): Player => ({
  user_id: id,
  display_name: id,
  avatar_color: color,
  room_id: room,
  position: { x, y: 0, z: 0 },
  rotation: { yaw: 0, pitch: 0 },
  movement_epoch: 1,
  ack_seq: 0,
})

test('себя не добавляет', () => {
  const r = new PlayerRegistry('me')
  r.upsert(p('me'), 0)
  expect(r.size).toBe(0)
})

test('players.state удаляет отсутствующих', () => {
  const r = new PlayerRegistry('me')
  r.upsert(p('a'), 0)
  r.upsert(p('b'), 0)
  r.applyState([p('me'), p('a')], 100)
  expect(r.visible('r1').map((x) => x.userId)).toEqual(['a'])
})

test('видны только игроки своего зала, цвет известен у всех', () => {
  const r = new PlayerRegistry('me')
  r.upsert(p('a', 'r2'), 0)
  expect(r.visible('r1')).toEqual([])
  expect(r.colorOf('a')).toBe('#112233')
})

test('позиция попадает в буфер интерполяции', () => {
  const r = new PlayerRegistry('me')
  r.upsert(p('a', 'r1', 0), 0)
  r.upsert(p('a', 'r1', 1), 100)
  expect(r.visible('r1')[0].buffer.sample(50)?.x).toBe(0.5)
})

test('player.left удаляет', () => {
  const r = new PlayerRegistry('me')
  r.upsert(p('a'), 0)
  r.remove('a')
  expect(r.size).toBe(0)
})

test('цвет себя задаётся через setSelf', () => {
  const r = new PlayerRegistry('me')
  r.setSelf(p('me', 'r1', 0, '#abcdef'))
  expect(r.colorOf('me')).toBe('#abcdef')
  expect(r.colorOf('nobody')).toBeNull()
})

test('clear очищает всё, включая себя', () => {
  const r = new PlayerRegistry('me')
  r.setSelf(p('me'))
  r.upsert(p('a'), 0)
  r.clear()
  expect(r.size).toBe(0)
  expect(r.colorOf('me')).toBeNull()
})
