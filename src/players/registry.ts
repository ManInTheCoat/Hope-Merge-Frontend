import type { Player } from '../network/contract'
import { SnapshotBuffer, type Pose2 } from './interpolation'

export type RemotePlayer = {
  userId: string
  displayName: string
  color: string
  roomId: string
  buffer: SnapshotBuffer
}

/**
 * Все подключённые игроки, кроме себя. Имя и цвет нужны чату для любого зала,
 * а капсулы рисуются только для игроков своего зала (`visible`).
 */
export class PlayerRegistry {
  private readonly selfId: string
  private selfColor: string | null = null
  private players = new Map<string, RemotePlayer>()

  constructor(selfId: string) {
    this.selfId = selfId
  }

  get size(): number {
    return this.players.size
  }

  setSelf(p: Player): void {
    this.selfColor = p.avatar_color
  }

  upsert(p: Player, now: number): void {
    if (p.user_id === this.selfId) return this.setSelf(p)
    let rp = this.players.get(p.user_id)
    if (!rp) {
      rp = { userId: p.user_id, displayName: p.display_name, color: p.avatar_color, roomId: p.room_id, buffer: new SnapshotBuffer() }
      this.players.set(p.user_id, rp)
    }
    rp.displayName = p.display_name
    rp.color = p.avatar_color
    rp.roomId = p.room_id
    rp.buffer.push({ t: now, x: p.position.x, z: p.position.z, yaw: p.rotation.yaw, epoch: p.movement_epoch })
  }

  remove(userId: string): void {
    this.players.delete(userId)
  }

  /** `players.state` — полный список: отсутствующих удаляем. */
  applyState(players: Player[], now: number): void {
    const present = new Set(players.map((p) => p.user_id))
    for (const id of this.players.keys()) if (!present.has(id)) this.players.delete(id)
    for (const p of players) this.upsert(p, now)
  }

  visible(roomId: string): RemotePlayer[] {
    return [...this.players.values()].filter((p) => p.roomId === roomId)
  }

  /** Интерполированная поза игрока в момент `renderTime` или null, если его нет или данных нет. */
  poseOf(userId: string, renderTime: number): Pose2 | null {
    return this.players.get(userId)?.buffer.sample(renderTime) ?? null
  }

  colorOf(userId: string): string | null {
    if (userId === this.selfId) return this.selfColor
    return this.players.get(userId)?.color ?? null
  }

  clear(): void {
    this.players.clear()
    this.selfColor = null
  }
}
