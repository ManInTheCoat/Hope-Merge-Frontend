import { expect, test } from 'bun:test'
import { loadMockState, MOCK_STORAGE_KEY, repairPose, saveMockState, type MockState } from '../src/network/mock/storage'

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(initial))
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  }
}

const throwing: Storage = {
  ...memoryStorage(),
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
}

const empty: MockState = { accounts: [], session: null }

const state: MockState = {
  accounts: [
    {
      user: { id: 'user_1', username: 'anna', display_name: 'Анна', avatar_color: '#e57373' },
      password: 'secret123',
      pose: { room_id: 'hall_2', position: { x: 1.5, y: 0, z: -2 }, rotation: { yaw: 0.7, pitch: -0.1 } },
    },
  ],
  session: 'anna',
}

test('сохранённое состояние читается обратно', () => {
  const s = memoryStorage()
  saveMockState(s, state)
  expect(loadMockState(s)).toEqual(state)
})

test('нет хранилища, исключение, мусор → пустое состояние', () => {
  expect(loadMockState(null)).toEqual(empty)
  expect(loadMockState(throwing)).toEqual(empty)
  expect(loadMockState(memoryStorage({ [MOCK_STORAGE_KEY]: '{oops' }))).toEqual(empty)
  expect(loadMockState(memoryStorage({ [MOCK_STORAGE_KEY]: '{"accounts":5}' }))).toEqual(empty)
  expect(loadMockState(memoryStorage({ [MOCK_STORAGE_KEY]: 'null' }))).toEqual(empty)
})

test('сессия без такого аккаунта сбрасывается', () => {
  const s = memoryStorage({ [MOCK_STORAGE_KEY]: JSON.stringify({ accounts: [], session: 'ghost' }) })
  expect(loadMockState(s)).toEqual(empty)
})

test('saveMockState не бросает, если setItem бросает', () => {
  expect(() => saveMockState(throwing, state)).not.toThrow()
  expect(() => saveMockState(null, state)).not.toThrow()
})

const start = { room_id: 'hall_1', position: { x: 0, y: 0, z: 5 }, rotation: { yaw: 0, pitch: 0 } }
const hasRoom = (id: string) => id === 'hall_1' || id === 'hall_2'

test('repairPose оставляет годную позу', () => {
  const pose = state.accounts[0].pose
  expect(repairPose(pose, hasRoom, start)).toEqual(pose)
})

test('repairPose: зала больше нет в мире → стартовая точка', () => {
  expect(repairPose({ ...state.accounts[0].pose, room_id: 'hall_gone' }, hasRoom, start)).toEqual(start)
})

test('repairPose: нет координат или они не числа → стартовая точка', () => {
  expect(repairPose({ room_id: 'hall_2', rotation: { yaw: 0, pitch: 0 } } as never, hasRoom, start)).toEqual(start)
  expect(repairPose({ room_id: 'hall_2', position: { x: 'a', y: 0, z: 1 }, rotation: { yaw: 0, pitch: 0 } } as never, hasRoom, start)).toEqual(start)
  expect(repairPose({ room_id: 'hall_2', position: { x: 1, y: 0, z: 1 } } as never, hasRoom, start)).toEqual(start)
})

test('repairPose возвращает копию стартовой точки, а не её саму', () => {
  expect(repairPose(null as never, hasRoom, start)).not.toBe(start)
})
