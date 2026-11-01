import type { Guide } from '../network/contract'
import { SUNDAY_EXTENSION, type SundayRoomRuntime } from '../network/sunday'

/** Что делать с пришедшим `world.runtime` (api-sunday.md §1). */
export type RuntimeVerdict = 'apply' | 'stale' | 'foreign' | 'invalid'

/** Сервер объявил расширение Sunday v1: без этого новые функции не показываются (api-sunday.md §1). */
export function hasSunday(manifest: { extensions?: string[] } | null | undefined): boolean {
  return manifest?.extensions?.includes(SUNDAY_EXTENSION) ?? false
}

/** room.sync: не чаще 2 раз за 10 с на пользователя (api-sunday.md §8). */
const SYNC_LIMIT = 2
const SYNC_WINDOW_MS = 10_000

const validRevision = (r: unknown): r is number => typeof r === 'number' && Number.isSafeInteger(r) && r >= 1

/**
 * Состояние runtime одного зала. Это полные снимки, не patches: первый снимок текущего зала применяется
 * независимо от revision, дальше — только с большей; чужой зал и чужая версия мира отбрасываются.
 */
export class RoomSync {
  private room: string | null
  private readonly version: string
  private last: SundayRoomRuntime | null = null
  private syncAt: number[] = []

  constructor(roomId: string | null, worldVersion: string) {
    this.room = roomId
    this.version = worldVersion
  }

  get roomId(): string | null {
    return this.room
  }

  /** Последний принятый снимок текущего зала или null, если его ещё не было. */
  get current(): SundayRoomRuntime | null {
    return this.last
  }

  judge(r: SundayRoomRuntime): RuntimeVerdict {
    if (!validRevision(r?.revision)) return 'invalid'
    if (r.room_id !== this.room || r.world_version !== this.version) return 'foreign'
    if (this.last && r.revision <= this.last.revision) return 'stale'
    return 'apply'
  }

  /** Принимает снимок; true — он новее и его надо применить. */
  accept(r: SundayRoomRuntime): boolean {
    if (this.judge(r) !== 'apply') return false
    this.last = r
    return true
  }

  /** Переход в другой зал (`world.entered`): состояние прежнего зала сбрасывается, лимит room.sync — нет. */
  enter(roomId: string): void {
    this.room = roomId
    this.last = null
  }

  /** Можно ли сейчас отправить room.sync; true занимает слот лимита. */
  tryRequestSync(nowMs: number): boolean {
    this.syncAt = this.syncAt.filter((t) => nowMs - t < SYNC_WINDOW_MS)
    if (this.syncAt.length >= SYNC_LIMIT) return false
    this.syncAt.push(nowMs)
    return true
  }
}

/**
 * Гиды зала с положением, поворотом и именем из runtime: он заменяет базовые значения (api-sunday.md §2).
 * Гид без записи в runtime остаётся как есть, лишние записи игнорируются.
 */
export function mergeGuides(base: Guide[], runtime: SundayRoomRuntime | null): Guide[] {
  if (!runtime) return base
  const byId = new Map(runtime.guides.map((g) => [g.guide_id, g]))
  return base.map((g) => {
    const r = byId.get(g.id)
    if (!r) return g
    return {
      ...g,
      display_name: r.display_name,
      subtitle: r.subtitle,
      position: { x: r.position.x, y: r.position.y, z: r.position.z },
      rotation_y: r.rotation_y,
    }
  })
}
