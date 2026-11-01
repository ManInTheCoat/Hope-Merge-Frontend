import type { Pose, User, Vec3 } from '../contract'

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

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Слияние при записи: другая вкладка могла зарегистрировать аккаунты, которых эта не видела.
 * Свои аккаунты и своя сессия побеждают, чужие сохраняются.
 */
export function mergeMockState(stored: MockState, mine: MockState): MockState {
  const byId = new Map(stored.accounts.map((a) => [a.user.id, a]))
  for (const a of mine.accounts) byId.set(a.user.id, a)
  return { accounts: [...byId.values()], session: mine.session }
}

/**
 * Поза из хранилища, пригодная для текущего мира: зал существует, координаты и поворот — числа, а точка
 * допустима для цилиндра игрока (`accepts`). Иначе стартовая точка, как делает сервер (api.md §2).
 */
export function repairPose(pose: Pose | null | undefined, accepts: (roomId: string, position: Vec3) => boolean, start: Pose): Pose {
  const p = pose?.position
  const r = pose?.rotation
  const ok =
    typeof pose?.room_id === 'string' &&
    finite(p?.x) &&
    finite(p?.z) &&
    finite(r?.yaw) &&
    finite(r?.pitch) &&
    accepts(pose.room_id, { x: p!.x, y: 0, z: p!.z })
  if (!ok) return { room_id: start.room_id, position: { ...start.position }, rotation: { ...start.rotation } }
  return { room_id: pose!.room_id, position: { x: p!.x, y: 0, z: p!.z }, rotation: { yaw: r!.yaw, pitch: r!.pitch } }
}
