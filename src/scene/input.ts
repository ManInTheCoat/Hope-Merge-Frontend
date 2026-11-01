import type { Vec2 } from './collision'

export type MoveState = { forward: boolean; back: boolean; left: boolean; right: boolean }

const KEY_MAP: Record<string, keyof MoveState> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
}

export class MoveKeys {
  private pressed = new Set<string>()

  onKeyDown(code: string): void {
    if (code in KEY_MAP) this.pressed.add(code)
  }

  onKeyUp(code: string): void {
    this.pressed.delete(code)
  }

  clear(): void {
    this.pressed.clear()
  }

  private readonly current: MoveState = { forward: false, back: false, left: false, right: false }

  /** Читается каждый кадр: один и тот же объект, без новой аллокации. */
  get state(): Readonly<MoveState> {
    const s = this.current
    s.forward = s.back = s.left = s.right = false
    for (const code of this.pressed) s[KEY_MAP[code]] = true
    return s
  }
}

/** Смещение за кадр. При yaw=0 вперёд — это −Z, вправо — +X. */
export function moveVector(keys: MoveState, yaw: number, speedMps: number, dt: number): Vec2 {
  const f = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0)
  const r = (keys.right ? 1 : 0) - (keys.left ? 1 : 0)
  const len = Math.hypot(f, r)
  if (len === 0) return { x: 0, z: 0 }
  const k = (speedMps * dt) / len
  const sin = Math.sin(yaw)
  const cos = Math.cos(yaw)
  return { x: (-sin * f + cos * r) * k, z: (-cos * f - sin * r) * k }
}

/**
 * Доля серверного предела скорости для отправки шага. Больше скорости ходьбы (CLIENT_SPEED_FACTOR): иначе
 * отставание отправленной позиции от игрока, появившись из-за дрожания кадров, больше не сокращается,
 * и на бегу сервер видит игрока на 0,3–1 м позади («слишком далеко от двери» при видимой подсказке).
 */
const SEND_SPEED_FACTOR = 0.95

/** Сколько метров можно отправить серверу за `elapsedMs` с прошлой отправки (сервер считает dt не больше 0,25 с). */
export function moveSendBudget(maxSpeedMps: number, elapsedMs: number): number {
  return maxSpeedMps * SEND_SPEED_FACTOR * Math.min(elapsedMs / 1000, 0.25)
}

/** Клиент ходит чуть медленнее серверного максимума: кадры и сеть дают джиттер, а сервер отклоняет весь шаг при превышении. */
export const CLIENT_SPEED_FACTOR = 0.9

/** Внеочередной `player.move` не отправляем сразу после планового: два шага в одном окне сервер отклонит по скорости. */
export function shouldSendMove(lastSentAtMs: number | null, nowMs: number, minGapMs: number): boolean {
  return lastSentAtMs === null || nowMs - lastSentAtMs >= minGapMs
}
