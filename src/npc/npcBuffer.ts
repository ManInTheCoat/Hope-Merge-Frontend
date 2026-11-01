import type { SundayNPC } from '../network/sunday'
import { SnapshotBuffer, type Pose2 } from '../players/interpolation'

/** NPC рисуем с отставанием в один период npc.state (5 Гц): между двумя известными точками (api-sunday.md §5). */
export const NPC_RENDER_DELAY_MS = 200

export type NpcPose = Pose2 & { id: string; state: SundayNPC['state']; speed_mps: number; phase: number }

type Meta = { t: number; state: SundayNPC['state']; speed_mps: number; phase: number }
type Entry = { buf: SnapshotBuffer; meta: Meta[] }

const META_KEEP = 8

/** Буферы интерполяции всех NPC зала. Снимок — полный список: отсутствующие ID удаляются. */
export class NpcBuffers {
  private entries = new Map<string, Entry>()

  apply(npcs: SundayNPC[], nowMs: number): void {
    const seen = new Set<string>()
    for (const n of npcs) {
      seen.add(n.npc_id)
      let e = this.entries.get(n.npc_id)
      if (!e) {
        e = { buf: new SnapshotBuffer(), meta: [] }
        this.entries.set(n.npc_id, e)
      }
      e.buf.push({ t: nowMs, x: n.position.x, z: n.position.z, yaw: n.yaw, epoch: 0 })
      e.meta.push({ t: nowMs, state: n.state, speed_mps: n.speed_mps, phase: n.phase })
      if (e.meta.length > META_KEEP) e.meta.shift()
    }
    for (const id of [...this.entries.keys()]) if (!seen.has(id)) this.entries.delete(id)
  }

  /** Позы на момент `nowMs - NPC_RENDER_DELAY_MS`, по возрастанию ID. */
  sample(nowMs: number): NpcPose[] {
    const renderTime = nowMs - NPC_RENDER_DELAY_MS
    const out: NpcPose[] = []
    for (const [id, e] of this.entries) {
      const p = e.buf.sample(renderTime)
      if (!p) continue
      let m = e.meta[0]
      for (const c of e.meta) if (c.t <= renderTime) m = c
      out.push({ ...p, id, state: m.state, speed_mps: m.speed_mps, phase: m.phase })
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  clear(): void {
    this.entries.clear()
  }
}
