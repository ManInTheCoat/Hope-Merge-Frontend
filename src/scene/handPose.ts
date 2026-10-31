/** Положение фотоаппарата в руке относительно камеры игрока (м): справа внизу, между строкой подсказок и карточкой фото; взгляд вдоль −Z. */
export const HAND_BASE = { x: 0.21, y: -0.19, z: -0.5 }

/** Длительность нажатия спуска и отдачи после снимка. */
export const HAND_KICK_MS = 220

const BOB_HZ = 1.8
const BOB_Y = 0.01
const BOB_X = 0.006
const KICK_Z = 0.03
const KICK_PITCH = 0.12

export type HandPoseInput = {
  timeS: number
  /** 0 — стоит, 1 — идёт полным шагом. */
  walking: number
  /** Сколько прошло с последнего снимка; null — снимков не было. */
  sinceShotMs: number | null
}

export type HandPose = { x: number; y: number; z: number; pitch: number; roll: number; shutter: number }

export function handPose({ timeS, walking, sinceShotMs }: HandPoseInput): HandPose {
  const w = Math.min(Math.max(walking, 0), 1)
  const phase = timeS * BOB_HZ * Math.PI * 2
  // Вертикаль — два раза за цикл шага (каждый шаг), горизонталь — раз за цикл, как при ходьбе.
  const bobY = -Math.abs(Math.sin(phase)) * BOB_Y * w
  const bobX = Math.sin(phase) * BOB_X * w

  // Отдача: резкий толчок и плавный возврат; кнопка нажата первую треть.
  let kick = 0
  let shutter = 0
  if (sinceShotMs !== null && sinceShotMs >= 0 && sinceShotMs < HAND_KICK_MS) {
    const k = sinceShotMs / HAND_KICK_MS
    const pressed = k < 1 / 3
    kick = pressed ? Math.sin((Math.PI / 2) * k * 3) : (1 - k) * 1.5
    shutter = pressed ? 1 : 0
  }

  return {
    x: HAND_BASE.x + bobX,
    y: HAND_BASE.y + bobY + kick * 0.01,
    z: HAND_BASE.z + kick * KICK_Z,
    pitch: kick * KICK_PITCH,
    roll: bobX * 2,
    shutter,
  }
}
