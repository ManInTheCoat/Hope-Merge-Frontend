/** Время плавного включения и выключения жеста, с. */
export const GESTURE_BLEND_S = 0.15

/**
 * Какие гиды жестикулируют: от `guide.started` до terminal своей генерации. У одного гида может быть
 * несколько живых генераций — жест держится, пока жива хотя бы одна.
 */
export class GestureTracker {
  private byGeneration = new Map<string, string>()

  start(guideId: string, generationId: string): void {
    this.byGeneration.set(generationId, guideId)
  }

  /** Terminal генерации (completed/failed); неизвестная генерация игнорируется. */
  stop(generationId: string): void {
    this.byGeneration.delete(generationId)
  }

  active(guideId: string): boolean {
    for (const g of this.byGeneration.values()) if (g === guideId) return true
    return false
  }

  clear(): void {
    this.byGeneration.clear()
  }
}

/** Вес жеста [0, 1]: приближается к 1 (active) или 0 за `GESTURE_BLEND_S`. */
export function gestureWeight(current: number, active: boolean, dtS: number): number {
  const step = dtS / GESTURE_BLEND_S
  return Math.min(1, Math.max(0, current + (active ? step : -step)))
}
