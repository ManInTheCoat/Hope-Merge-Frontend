import type { Pose, User } from '../contract'

export type StoredAccount = { user: User; password: string; pose: Pose }
/** `session` — username вошедшего: у реального бэкенда cookie переживает перезагрузку страницы. */
export type MockState = { accounts: StoredAccount[]; session: string | null }

export const MOCK_STORAGE_KEY = 'hope-merge-mock-v1'

const empty = (): MockState => ({ accounts: [], session: null })

export function loadMockState(storage: Storage | null): MockState {
  try {
    const raw = storage?.getItem(MOCK_STORAGE_KEY)
    if (!raw) return empty()
    const data = JSON.parse(raw) as Partial<MockState> | null
    if (!data || !Array.isArray(data.accounts)) return empty()
    const accounts = data.accounts.filter(
      (a) => a && typeof a.password === 'string' && typeof a.user?.username === 'string' && typeof a.pose?.room_id === 'string',
    )
    const session = typeof data.session === 'string' && accounts.some((a) => a.user.username === data.session) ? data.session : null
    return { accounts, session }
  } catch {
    return empty()
  }
}

export function saveMockState(storage: Storage | null, state: MockState): void {
  try {
    storage?.setItem(MOCK_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // хранилище недоступно или переполнено: мок продолжает работать в памяти
  }
}
