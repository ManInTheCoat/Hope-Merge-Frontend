import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mergeGuides, RoomSync } from '../src/room/sync'
import type { Guide } from '../src/network/contract'
import type { SundayRoomRuntime } from '../src/network/sunday'

const fixture: SundayRoomRuntime = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures', 'sunday', 'world.runtime.json'), 'utf8'),
).payload

const at = (revision: number, over: Partial<SundayRoomRuntime> = {}): SundayRoomRuntime => ({ ...fixture, revision, ...over })
const fresh = () => new RoomSync(fixture.room_id, fixture.world_version)

test('первый снимок зала применяется независимо от revision', () => {
  const s = fresh()
  expect(s.accept(at(57))).toBe(true)
  expect(s.current?.revision).toBe(57)
})

test('дальше — только с большей revision', () => {
  const s = fresh()
  s.accept(at(5))
  expect(s.judge(at(5))).toBe('stale')
  expect(s.judge(at(4))).toBe('stale')
  expect(s.accept(at(4))).toBe(false)
  expect(s.current?.revision).toBe(5)
  expect(s.accept(at(6))).toBe(true)
})

test('чужой зал и чужая версия мира отбрасываются', () => {
  const s = fresh()
  expect(s.judge(at(1, { room_id: 'other' }))).toBe('foreign')
  expect(s.judge(at(1, { world_version: 'old' }))).toBe('foreign')
  expect(s.accept(at(1, { room_id: 'other' }))).toBe(false)
  expect(s.current).toBeNull()
})

test('revision не положительное целое — снимок невалиден', () => {
  const s = fresh()
  for (const bad of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 2]) expect(s.judge(at(bad))).toBe('invalid')
})

test('переход в другой зал сбрасывает состояние: первый снимок нового зала применяется', () => {
  const s = fresh()
  s.accept(at(9))
  s.enter('room_next')
  expect(s.current).toBeNull()
  expect(s.accept(at(9))).toBe(false) // снимок прежнего зала теперь чужой
  expect(s.accept(at(2, { room_id: 'room_next' }))).toBe(true)
})

test('возврат в зал после перехода принимает первый снимок снова, даже с меньшей revision', () => {
  const s = fresh()
  s.accept(at(9))
  s.enter('room_next')
  s.enter(fixture.room_id)
  expect(s.accept(at(3))).toBe(true)
})

test('room.sync: не больше двух запросов за 10 с', () => {
  const s = fresh()
  expect(s.tryRequestSync(0)).toBe(true)
  expect(s.tryRequestSync(1000)).toBe(true)
  expect(s.tryRequestSync(2000)).toBe(false)
  expect(s.tryRequestSync(9_999)).toBe(false)
  expect(s.tryRequestSync(10_000)).toBe(true) // слот первого запроса освободился ровно через окно
})

const baseGuide = (id: string): Guide => ({
  id,
  display_name: 'База',
  subtitle: 'Старое',
  position: { x: 1, y: 0, z: 1 },
  rotation_y: 0,
  interaction_radius_m: 3,
})

test('mergeGuides: положение, поворот и имя из runtime; прочее и чужие записи — как есть', () => {
  const base = [baseGuide('guide_leonardo'), baseGuide('guide_other')]
  const rt = at(1, {
    guides: [
      { guide_id: 'guide_leonardo', display_name: 'Леонардо', subtitle: 'Учебная реконструкция', position: { x: 6, y: 0, z: 7.5 }, rotation_y: 1.5 },
      { guide_id: 'guide_ghost', display_name: 'Нет такого', subtitle: '', position: { x: 0, y: 0, z: 0 }, rotation_y: 0 },
    ],
  })
  const merged = mergeGuides(base, rt)
  expect(merged).toHaveLength(2)
  expect(merged[0]).toMatchObject({ id: 'guide_leonardo', display_name: 'Леонардо', subtitle: 'Учебная реконструкция', position: { x: 6, y: 0, z: 7.5 }, rotation_y: 1.5, interaction_radius_m: 3 })
  expect(merged[1]).toBe(base[1])
  expect(base[0].display_name).toBe('База') // исходный список не меняется
})

test('mergeGuides без runtime отдаёт тот же список', () => {
  const base = [baseGuide('g')]
  expect(mergeGuides(base, null)).toBe(base)
})
