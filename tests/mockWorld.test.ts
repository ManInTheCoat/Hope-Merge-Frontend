import { expect, test } from 'bun:test'
import { buildWorld } from '../src/network/mock/world'

const world = await buildWorld(async () => new Blob([new Uint8Array(64)], { type: 'image/jpeg' }))
const rooms = [...world.rooms.values()].map((r) => r.room)

test('в каждом зале свой гид: история диалога не общая на все залы', () => {
  const ids = rooms.flatMap((r) => r.guides.map((g) => g.id))
  expect(ids.length).toBe(rooms.length)
  expect(new Set(ids).size).toBe(ids.length)
})

test('гид называется «Гид», а не «Куратор»', () => {
  for (const r of rooms) for (const g of r.guides) expect(g.display_name).toBe('Гид')
})
