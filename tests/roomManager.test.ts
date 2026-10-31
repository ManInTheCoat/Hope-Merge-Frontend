import { expect, test } from 'bun:test'
import { ContentError, RoomManager, type RoomManagerDeps } from '../src/world/RoomManager'
import type { Room, RoomPackage } from '../src/network/contract'
import { AssetBudget } from '../src/world/AssetBudget'

const room = { id: 'hall', world_version: 'v1', title: 'Зал', exhibits: [], doors: [], guides: [], surfaces: [] } as unknown as Room
const roomText = JSON.stringify(room)
const roomTextBytes = new TextEncoder().encode(roomText).length
const pkg = (over: Partial<RoomPackage> = {}): RoomPackage => ({
  room_id: 'hall',
  descriptor_bytes: new TextEncoder().encode(roomText).length,
  assets: [
    { id: 'a1', bytes: 10, content_type: 'image/jpeg' },
    { id: 'a2', bytes: 20, content_type: 'image/jpeg' },
  ],
  ...over,
})

function setup(over: Partial<RoomManagerDeps> = {}) {
  const budget = over.budget ?? new AssetBudget(1_000_000)
  const closed: string[] = []
  const calls: string[] = []
  const deps: RoomManagerDeps = {
    version: 'v1',
    budget,
    fetchRoomText: async (id, version) => {
      calls.push(`room:${id}:${version}`)
      return roomText
    },
    fetchAssetBlob: async (id, version) => {
      calls.push(`asset:${id}:${version}`)
      return new Blob([new Uint8Array(id === 'a1' ? 10 : 20)])
    },
    decode: async (blob) => ({ size: blob.size, close: () => closed.push(String(blob.size)) }) as unknown as ImageBitmap,
    ...over,
  }
  return { manager: new RoomManager(deps), closed, calls, budget }
}

test('загружает зал и ассеты', async () => {
  const { manager } = setup()
  const loaded = await manager.load(pkg(), new AbortController().signal)
  expect(loaded.room.id).toBe('hall')
  expect([...loaded.bitmaps.keys()].sort()).toEqual(['a1', 'a2'])
  expect(manager.current).toBe(loaded)
})

test('передаёт версию мира в запросы', async () => {
  const { manager, calls } = setup()
  await manager.load(pkg(), new AbortController().signal)
  expect(calls).toContain('room:hall:v1')
  expect(calls).toContain('asset:a1:v1')
  expect(calls).toContain('asset:a2:v1')
})

test('ответ больше объявленного — ContentError, битмапы закрыты', async () => {
  const { manager, closed } = setup()
  const p = pkg({ assets: [{ id: 'a1', bytes: 10, content_type: 'image/jpeg' }, { id: 'a2', bytes: 5, content_type: 'image/jpeg' }] })
  await expect(manager.load(p, new AbortController().signal)).rejects.toBeInstanceOf(ContentError)
  expect(manager.current).toBeNull()
  expect(closed.length).toBe(1) // a1 успел декодироваться и обязан быть закрыт
})

test('описание больше объявленного — ContentError', async () => {
  const { manager } = setup()
  await expect(manager.load(pkg({ descriptor_bytes: 5 }), new AbortController().signal)).rejects.toBeInstanceOf(ContentError)
})

test('несовпадение room.id — ContentError', async () => {
  const { manager } = setup()
  await expect(manager.load(pkg({ room_id: 'other' }), new AbortController().signal)).rejects.toBeInstanceOf(ContentError)
})

test('404 ассета пробрасывается, current остаётся null', async () => {
  const { manager } = setup({
    fetchAssetBlob: async () => {
      throw new Error('404')
    },
  })
  await expect(manager.load(pkg(), new AbortController().signal)).rejects.toThrow('404')
  expect(manager.current).toBeNull()
})

test('abort во время загрузки — AbortError и закрытые битмапы', async () => {
  const ac = new AbortController()
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const { manager, closed } = setup({
    fetchAssetBlob: async (id) => {
      await gate
      return new Blob([new Uint8Array(id === 'a1' ? 10 : 20)])
    },
  })
  const p = manager.load(pkg(), ac.signal)
  ac.abort()
  release()
  await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  expect(manager.current).toBeNull()
  expect(closed.length).toBe(2)
})

test('unload закрывает битмапы и обнуляет current', async () => {
  const { manager, closed } = setup()
  await manager.load(pkg(), new AbortController().signal)
  manager.unload()
  expect(closed.length).toBe(2)
  expect(manager.current).toBeNull()
})

test('повторный load выгружает прежний зал', async () => {
  const { manager, closed } = setup()
  await manager.load(pkg(), new AbortController().signal)
  await manager.load(pkg(), new AbortController().signal)
  expect(closed.length).toBe(2)
  expect(manager.current).not.toBeNull()
})

test('объявленный размер передаётся в загрузку как лимит', async () => {
  const limits: string[] = []
  const { manager } = setup({
    fetchRoomText: async (id, _v, maxBytes) => {
      limits.push(`room:${id}:${maxBytes}`)
      return roomText
    },
    fetchAssetBlob: async (id, _v, maxBytes) => {
      limits.push(`asset:${id}:${maxBytes}`)
      return new Blob([new Uint8Array(id === 'a1' ? 10 : 20)])
    },
  })
  await manager.load(pkg(), new AbortController().signal)
  expect(limits).toContain(`room:hall:${pkg().descriptor_bytes}`)
  expect(limits).toContain('asset:a1:10')
  expect(limits).toContain('asset:a2:20')
})

test('сбой одного ассета отменяет остальные загрузки', async () => {
  let siblingAborted = false
  const { manager } = setup({
    fetchAssetBlob: (id, _v, _max, signal) => {
      if (id === 'a1') return Promise.reject(new Error('404'))
      return new Promise((resolve) => {
        const done = () => resolve(new Blob([new Uint8Array(20)]))
        signal?.addEventListener('abort', () => {
          siblingAborted = true
          done()
        })
        setTimeout(done, 300)
      })
    },
  })
  await expect(manager.load(pkg(), new AbortController().signal)).rejects.toThrow('404')
  expect(siblingAborted).toBe(true)
})

test('после загрузки used = сумма фактических размеров', async () => {
  const { manager, budget } = setup()
  await manager.load(pkg(), new AbortController().signal)
  expect(budget.used).toBe(roomTextBytes + 30)
})

test('фактический размер меньше объявленного заменяет резерв', async () => {
  const { manager, budget } = setup({
    fetchAssetBlob: async (id) => new Blob([new Uint8Array(id === 'a1' ? 10 : 15)]),
  })
  await manager.load(pkg(), new AbortController().signal)
  expect(budget.used).toBe(roomTextBytes + 25)
})

test('unload освобождает бюджет', async () => {
  const { manager, budget } = setup()
  await manager.load(pkg(), new AbortController().signal)
  manager.unload()
  expect(budget.used).toBe(0)
})

test('сбой загрузки освобождает все резервы', async () => {
  const { manager, budget } = setup({
    fetchAssetBlob: async (id) => {
      if (id === 'a1') throw new Error('404')
      return new Blob([new Uint8Array(20)])
    },
  })
  await expect(manager.load(pkg(), new AbortController().signal)).rejects.toThrow('404')
  expect(budget.used).toBe(0)
})

test('превышение бюджета — ContentError и used = 0', async () => {
  const { manager, budget } = setup({ budget: new AssetBudget(roomTextBytes + 15) })
  await expect(manager.load(pkg(), new AbortController().signal)).rejects.toBeInstanceOf(ContentError)
  expect(budget.used).toBe(0)
  expect(manager.current).toBeNull()
})

test('резерв отменённой загрузки снимается только после завершения чтения', async () => {
  const ac = new AbortController()
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const { manager, budget } = setup({
    fetchAssetBlob: async (id) => {
      await gate
      return new Blob([new Uint8Array(id === 'a1' ? 10 : 20)])
    },
  })
  const p = manager.load(pkg(), ac.signal)
  ac.abort()
  await Promise.resolve()
  expect(budget.used).toBeGreaterThan(0)
  release()
  await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  expect(budget.used).toBe(0)
})

test('повторный load не держит оба зала', async () => {
  let usedAtSecondStart = -1
  let second = false
  const { manager, budget } = setup({
    fetchRoomText: async () => {
      if (second && usedAtSecondStart < 0) usedAtSecondStart = budget.used - roomTextBytes // свой резерв описания уже сделан
      return roomText
    },
  })
  await manager.load(pkg(), new AbortController().signal)
  second = true
  await manager.load(pkg(), new AbortController().signal)
  expect(usedAtSecondStart).toBeLessThanOrEqual(30) // только резервы нового пакета, без старого зала
  expect(budget.used).toBe(roomTextBytes + 30)
})
