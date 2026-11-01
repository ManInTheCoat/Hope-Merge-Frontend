import { expect, test } from 'bun:test'
import { buildWorld } from '../src/network/mock/world'

const world = await buildWorld(async () => new Blob([new Uint8Array(64)], { type: 'image/jpeg' }))
const rooms = [...world.rooms.values()].map((r) => r.room)

test('в каждом зале свой гид: история диалога не общая на все залы', () => {
  const ids = rooms.flatMap((r) => r.guides.map((g) => g.id))
  expect(ids.length).toBeGreaterThanOrEqual(rooms.length)
  expect(new Set(ids).size).toBe(ids.length)
})

test('гиды мока — согласованные личности: Моне, Леонардо, Ван Гог', () => {
  const names = rooms.flatMap((r) => r.guides.map((g) => g.display_name)).sort()
  expect(names).toEqual(['Винсент Ван Гог', 'Клод Моне', 'Леонардо да Винчи'])
})
