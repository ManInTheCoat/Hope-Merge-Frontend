import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AIM_STEP,
  HEAD_PITCH_MAX,
  heldPosition,
  holdsLamp,
  keyAct,
  lampErrorText,
  lampHint,
  pickLamp,
  placeAct,
  takeAct,
} from '../src/lamp/lampActions'
import type { SundayLamp, SundayRoomRuntime } from '../src/network/sunday'

const fixture: SundayRoomRuntime = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures', 'sunday', 'world.runtime.json'), 'utf8'),
).payload
const ctx = { movementEpoch: 1, revision: 5 }
const withLamp = (patch: Partial<SundayLamp>): SundayRoomRuntime => ({ ...fixture, lamp: { ...fixture.lamp, ...patch } })

// Слот a — (3, 0, 4). Взгляд из (3, 1.65, 6) вперёд (−Z) и вниз попадает в цилиндр лампы.
const look = (x: number, z: number, dx = 0, dy = -0.4, dz = -1) => {
  const len = Math.hypot(dx, dy, dz)
  return { eye: { x, y: 1.65, z }, dir: { x: dx / len, y: dy / len, z: dz / len }, rangeFrom: { x, z } }
}

test('команды совпадают с фикстурами контракта', () => {
  const fx = (n: string) => JSON.parse(readFileSync(join(import.meta.dir, 'fixtures', 'sunday', `object.act.${n}.json`), 'utf8')).payload
  const c = { movementEpoch: 1, revision: 1 }
  expect(takeAct(c)).toEqual(fx('take'))
  expect(placeAct(c, 'b')).toEqual(fx('place'))
  expect(keyAct('KeyQ', { ...fixture.lamp, on: true }, c)).toEqual(fx('power'))
  expect(keyAct('KeyZ', { ...fixture.lamp, yaw: 0.4 - AIM_STEP, head_pitch: 0.2 }, c)).toMatchObject({ action: 'aim', head_pitch: 0.2 })
})

test('стоящая лампа в прицеле — цель «лампа»; в руках — только слоты', () => {
  expect(pickLamp(look(3, 6), fixture, 'usr_01')?.target).toEqual({ kind: 'lamp' })
  expect(pickLamp(look(3, 6), withLamp({ holder_user_id: 'usr_01' }), 'usr_01')?.target).toEqual({ kind: 'slot', slotId: 'a' })
  // слот b — (9, 0, 4)
  expect(pickLamp(look(9, 6), withLamp({ holder_user_id: 'usr_01' }), 'usr_01')?.target).toEqual({ kind: 'slot', slotId: 'b' })
})

test('чужая лампа в руках не цель; мимо и далеко — null', () => {
  expect(pickLamp(look(3, 6), withLamp({ holder_user_id: 'usr_02' }), 'usr_01')).toBeNull()
  expect(pickLamp(look(3, 6, 1, -0.4, 0), fixture, 'usr_01')).toBeNull() // взгляд в сторону
  expect(pickLamp(look(3, 9), fixture, 'usr_01')).toBeNull() // дальше 2,8 м
})

test('стена между игроком и лампой скрывает цель', () => {
  const wall = { minX: 2, maxX: 4, minY: 0, maxY: 3, minZ: 4.8, maxZ: 5.2 }
  expect(pickLamp({ ...look(3, 6), colliders: [wall] }, fixture, 'usr_01')).toBeNull()
})

test('holdsLamp: только владелец', () => {
  expect(holdsLamp(withLamp({ holder_user_id: 'usr_01' }), 'usr_01')).toBe(true)
  expect(holdsLamp(withLamp({ holder_user_id: 'usr_02' }), 'usr_01')).toBe(false)
  expect(holdsLamp(null, 'usr_01')).toBe(false)
})

test('поворот головки: шаг, обёртка yaw в [−π, π) и предел наклона ±π/3', () => {
  const lamp = (yaw: number, head_pitch: number): SundayLamp => ({ ...fixture.lamp, yaw, head_pitch })
  const yawOf = (code: string, l: SundayLamp) => (keyAct(code, l, ctx) as { yaw: number }).yaw
  const pitchOf = (code: string, l: SundayLamp) => (keyAct(code, l, ctx) as { head_pitch: number }).head_pitch
  expect(yawOf('KeyZ', lamp(0, 0))).toBeCloseTo(AIM_STEP)
  expect(yawOf('KeyX', lamp(0, 0))).toBeCloseTo(-AIM_STEP)
  const wrapped = yawOf('KeyZ', lamp(Math.PI - 0.01, 0))
  expect(wrapped).toBeGreaterThanOrEqual(-Math.PI)
  expect(wrapped).toBeLessThan(Math.PI)
  expect(wrapped).toBeLessThan(0)
  expect(pitchOf('KeyV', lamp(0, HEAD_PITCH_MAX - 0.01))).toBeCloseTo(HEAD_PITCH_MAX)
  expect(pitchOf('KeyC', lamp(0, -HEAD_PITCH_MAX + 0.01))).toBeCloseTo(-HEAD_PITCH_MAX)
  expect(keyAct('KeyL', fixture.lamp, ctx)).toBeNull()
  expect(keyAct('KeyQ', lamp(0, 0), ctx)).toMatchObject({ action: 'power', on: false })
})

test('лампа в руках: справа 0,35 м и на метр выше пола, направление следует yaw', () => {
  expect(heldPosition({ x: 2, z: 3, yaw: 0 })).toEqual({ x: 2.35, y: 1, z: 3 })
  const p = heldPosition({ x: 2, z: 3, yaw: Math.PI / 2 }) // взгляд в −X, справа — −Z... правая рука при yaw=π/2 смотрит в −Z
  expect(p.x).toBeCloseTo(2)
  expect(p.z).toBeCloseTo(3 - 0.35)
})

test('тексты: OBJECT_BUSY — «Лампу держит другой игрок», подсказки и технические ошибки', () => {
  expect(lampErrorText({ code: 'OBJECT_BUSY', message: 'x' })).toBe('Лампу держит другой игрок')
  expect(lampErrorText({ code: 'RATE_LIMITED', message: 'x', retry_after_ms: 2500 })).toBe('Слишком часто, подождите 3 с')
  expect(lampErrorText(new Error('REQUEST_TIMEOUT'))).not.toContain('REQUEST_TIMEOUT')
  expect(lampHint({ kind: 'lamp' })).toContain('E — взять')
  expect(lampHint({ kind: 'slot', slotId: 'b' })).toContain('поставить')
})
