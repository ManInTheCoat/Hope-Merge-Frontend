import type { SundayNPCState } from '../network/sunday'

const validSeq = (s: unknown): s is number => typeof s === 'number' && Number.isSafeInteger(s) && s >= 1

/**
 * Приём `npc.state` (api-sunday.md §5): полные снимки, чужой зал и версия мира отбрасываются; новая
 * `room_instance_id` принимается сразу, внутри одной instance — только растущий `seq`.
 */
export class NpcSync {
  private room: string | null
  private readonly version: string
  private last: SundayNPCState | null = null

  constructor(roomId: string | null, worldVersion: string) {
    this.room = roomId
    this.version = worldVersion
  }

  get current(): SundayNPCState | null {
    return this.last
  }

  /** true — снимок новее и его надо применить. */
  accept(s: SundayNPCState): boolean {
    if (!validSeq(s?.seq) || !Array.isArray(s.npcs)) return false
    if (s.room_id !== this.room || s.world_version !== this.version) return false
    if (this.last && this.last.room_instance_id === s.room_instance_id && s.seq <= this.last.seq) return false
    this.last = s
    return true
  }

  /** Переход в другой зал (`world.entered`): прежняя instance и seq забываются. */
  enter(roomId: string): void {
    this.room = roomId
    this.last = null
  }
}
