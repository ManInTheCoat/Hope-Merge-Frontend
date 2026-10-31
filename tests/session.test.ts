import { expect, test } from 'bun:test'
import type { Player, Room } from '../src/network/contract'
import type { BuiltRoom } from '../src/scene/roomBuilder'
import { AssetBudget } from '../src/world/AssetBudget'
import { RoomManager } from '../src/world/RoomManager'
import { applySelf, newSession, unloadRoom } from '../src/world/session'

const self: Player = {
  user_id: 'u1',
  display_name: 'Алиса',
  avatar_color: '#112233',
  room_id: 'r2',
  position: { x: 3, y: 0, z: 4 },
  rotation: { yaw: 0.5, pitch: -0.1 },
  movement_epoch: 7,
  ack_seq: 0,
}

test('applySelf: поза, epoch, обнулённые seq, история и путь движения', () => {
  const s = newSession()
  s.seq = 42
  s.lastMoveSentAt = 123
  s.history.record(42, { x: 9, z: 9 })
  s.path.record({ x: 9, z: 9 })
  const view = { yaw: 0, pitch: 0 }
  applySelf(s, self, view)
  expect(s.pos).toEqual({ x: 3, z: 4 })
  expect(s.epoch).toBe(7)
  expect(s.seq).toBe(0)
  expect(s.lastMoveSentAt).toBeNull()
  expect(s.history.reconcile(42, { x: 0, z: 0 })).toBeNull() // старая история забыта
  expect(s.path.pending).toBe(false)
  expect(s.path.sent).toEqual({ x: 3, z: 4 })
  expect(s.roomId).toBe('r2')
  expect(view).toEqual({ yaw: 0.5, pitch: -0.1 })
})

function loadedRoom() {
  const budget = new AssetBudget(1_000_000)
  let closed = 0
  const room = { id: 'r1', exhibits: [], guides: [], doors: [] } as unknown as Room
  const manager = new RoomManager({
    version: 'v1',
    budget,
    fetchRoom: async () => ({ room, bytes: 100 }),
    fetchAssetBlob: async () => new Blob([new Uint8Array(10)]),
    decode: async () => ({ close: () => closed++ }) as unknown as ImageBitmap,
  })
  return { budget, manager, closed: () => closed }
}

test('unloadRoom при переходе и затем при обрыве освобождает зал ровно один раз', async () => {
  const { budget, manager, closed } = loadedRoom()
  await manager.load({ room_id: 'r1', descriptor_bytes: 100, assets: [{ id: 'a', bytes: 10, content_type: 'image/jpeg' }] }, new AbortController().signal)
  const s = newSession()
  let disposed = 0
  let removed = 0
  s.built = { group: {}, dispose: () => disposed++ } as unknown as BuiltRoom
  s.moveWorld = { colliders: [], bounds: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 } }
  s.exhibits = [{}] as never
  const scene = { remove: () => removed++ }

  unloadRoom(s, scene, manager) // начат переход через дверь
  unloadRoom(s, scene, manager) // обрыв во время перехода
  expect(disposed).toBe(1)
  expect(removed).toBe(1)
  expect(closed()).toBe(1)
  expect(budget.used).toBe(0)
  expect(s.built).toBeNull()
  expect(s.moveWorld).toBeNull()
  expect(s.exhibits).toEqual([])
})
