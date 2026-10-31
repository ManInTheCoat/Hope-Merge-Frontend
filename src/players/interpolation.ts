import { wrapAngle } from '../scene/input'

/** Снимок удалённого игрока; `t` — локальное время получения, мс. */
export type Sample = { t: number; x: number; z: number; yaw: number; epoch: number }
export type Pose2 = { x: number; z: number; yaw: number }

/**
 * Удалённых игроков рисуем с этим отставанием: между двумя известными точками, а не наугад.
 * Два периода players.state (10 Гц): при джиттере доставки следующий снимок успевает прийти.
 */
export const RENDER_DELAY_MS = 200
const MAX_AGE_MS = 1000
/** Скачок дальше этого — телепорт: переставляем сразу, без «полёта» сквозь стены. */
const SNAP_DISTANCE_M = 2

export class SnapshotBuffer {
  private samples: Sample[] = []

  get size(): number {
    return this.samples.length
  }

  push(s: Sample): void {
    const last = this.samples[this.samples.length - 1]
    if (last && (last.epoch !== s.epoch || Math.hypot(s.x - last.x, s.z - last.z) > SNAP_DISTANCE_M)) {
      this.samples = []
    }
    this.samples.push(s)
    // Старые снимки не нужны, но один до момента отрисовки оставляем: между ним и следующим интерполируем.
    const renderTime = s.t - RENDER_DELAY_MS
    while (this.samples.length > 1 && s.t - this.samples[0].t > MAX_AGE_MS && this.samples[1].t <= renderTime) {
      this.samples.shift()
    }
  }

  sample(renderTime: number): Pose2 | null {
    const list = this.samples
    if (!list.length) return null
    if (renderTime <= list[0].t) return pose(list[0])
    for (let i = 1; i < list.length; i++) {
      const b = list[i]
      if (renderTime <= b.t) {
        const a = list[i - 1]
        const k = (renderTime - a.t) / (b.t - a.t)
        return {
          x: a.x + (b.x - a.x) * k,
          z: a.z + (b.z - a.z) * k,
          yaw: wrapAngle(a.yaw + wrapAngle(b.yaw - a.yaw) * k),
        }
      }
    }
    return pose(list[list.length - 1])
  }
}

const pose = (s: Sample): Pose2 => ({ x: s.x, z: s.z, yaw: s.yaw })
