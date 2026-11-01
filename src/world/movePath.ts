import { segmentClear, type MoveWorld, type Vec2 } from '../scene/collision'

const SAME_POINT_M = 1e-9
const STEP_TOLERANCE_M = 1e-6

/**
 * Позиции кадров с прошлой отправки `player.move`. Сервер проверяет прямой путь между двумя
 * принятыми позициями (api.md §5), а игрок огибает углы по дуге: отправляем точки самой траектории,
 * чтобы каждый отрезок между отправками был чист и не длиннее допустимого по скорости.
 */
export class MovePath {
  private last: Vec2 = { x: 0, z: 0 }
  private points: Vec2[] = []

  /** Новая отправная точка: вход, переход, коррекция по серверу. */
  reset(at: Vec2): void {
    this.last = { x: at.x, z: at.z }
    this.points = []
  }

  /** Позиция после кадра. */
  record(p: Vec2): void {
    const prev = this.points[this.points.length - 1] ?? this.last
    if (Math.hypot(p.x - prev.x, p.z - prev.z) > SAME_POINT_M) this.points.push({ x: p.x, z: p.z })
  }

  /** Остались точки, которые ещё не отправлены. */
  get pending(): boolean {
    return this.points.length > 0
  }

  /** Последняя отправленная точка. */
  get sent(): Vec2 {
    return { x: this.last.x, z: this.last.z }
  }

  /**
   * Самая дальняя точка траектории с чистым отрезком от прошлой отправки и не дальше `maxStepM`;
   * null — двигаться некуда. Если ближайшая точка дальше `maxStepM` (вкладка была в фоне), отдаём
   * точку на этом отрезке на расстоянии `maxStepM`.
   */
  take(world: MoveWorld, radius: number, maxStepM: number): Vec2 | null {
    if (this.points.length === 0) return null
    const from = this.last
    for (let i = this.points.length - 1; i >= 0; i--) {
      const p = this.points[i]
      if (Math.hypot(p.x - from.x, p.z - from.z) > maxStepM + STEP_TOLERANCE_M) continue
      if (!segmentClear(from, p, world, radius)) continue
      this.points = this.points.slice(i + 1)
      this.last = { x: p.x, z: p.z }
      return this.sent
    }
    // Ни одна точка не подошла: идём к ближайшей по прямой не дальше maxStepM.
    const first = this.points[0]
    const d = Math.hypot(first.x - from.x, first.z - from.z)
    const k = Math.min(1, maxStepM / d)
    const p = { x: from.x + (first.x - from.x) * k, z: from.z + (first.z - from.z) * k }
    if (k >= 1) this.points = this.points.slice(1)
    this.last = p
    return this.sent
  }
}
