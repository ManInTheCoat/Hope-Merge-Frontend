export type QualityOptions = { min: number; max: number; step: number; lowFps: number; highFps: number; windowS: number }

/** Подстройка pixelRatio под машину: средний FPS за окно ниже порога — чёткость ниже, с запасом — выше. */
export class QualityGovernor {
  private readonly o: QualityOptions
  ratio: number
  private elapsed = 0
  private frames = 0

  constructor(o: QualityOptions) {
    this.o = o
    this.ratio = o.max
  }

  /** Новый pixelRatio, если его пора сменить, иначе null. */
  sample(dtS: number): number | null {
    this.elapsed += dtS
    this.frames++
    if (this.elapsed < this.o.windowS - 1e-6) return null
    const fps = this.frames / this.elapsed
    this.elapsed = 0
    this.frames = 0
    let next = this.ratio
    if (fps < this.o.lowFps) next = Math.max(this.o.min, this.ratio - this.o.step)
    else if (fps > this.o.highFps) next = Math.min(this.o.max, this.ratio + this.o.step)
    if (Math.abs(next - this.ratio) < 1e-6) return null
    this.ratio = next
    return next
  }
}
