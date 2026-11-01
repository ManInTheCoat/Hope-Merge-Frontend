import { wrapAngle } from './angles'
import { LAMP_KEYS } from '../lamp/lampActions'
import { MoveKeys } from './input'

const SENSITIVITY = 0.002
const PITCH_LIMIT = Math.PI / 2 - 0.01

export function typingInField(): boolean {
  const el = document.activeElement as (Element & { isContentEditable?: boolean }) | null
  return (
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || !!el?.isContentEditable
  )
}

export class FirstPersonControls {
  yaw = 0
  pitch = 0
  readonly keys = new MoveKeys()
  /** false: клавиши и мышь игнорируются (загрузка, открытая карточка). */
  enabled = true
  onInteract: (() => void) | null = null
  /** Клавиши настройки лампы (вкл/выкл, поворот, наклон): нажатие без повтора. */
  onLampKey: ((code: string) => void) | null = null

  private readonly el: HTMLElement
  private readonly onLockChange: (locked: boolean) => void

  constructor(el: HTMLElement, onLockChange: (locked: boolean) => void) {
    this.el = el
    this.onLockChange = onLockChange

    document.addEventListener('pointerlockchange', () => {
      if (!this.locked) this.keys.clear()
      this.onLockChange(this.locked)
    })
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return
      this.yaw = wrapAngle(this.yaw - e.movementX * SENSITIVITY)
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - e.movementY * SENSITIVITY))
    })
    document.addEventListener('keydown', (e) => {
      if (!this.enabled || typingInField()) return
      if (e.code === 'KeyE') {
        // Взаимодействие может открыть окно с полем ввода: буква этого нажатия не должна туда попасть,
        // а другие обработчики по defaultPrevented видят, что нажатие уже обработано.
        e.preventDefault()
        if (!e.repeat) this.onInteract?.()
        return
      }
      if (LAMP_KEYS.has(e.code)) {
        if (!e.repeat) this.onLampKey?.(e.code)
        return
      }
      this.keys.onKeyDown(e.code)
    })
    document.addEventListener('keyup', (e) => this.keys.onKeyUp(e.code))
    window.addEventListener('blur', () => this.keys.clear())
  }

  get locked(): boolean {
    return document.pointerLockElement === this.el
  }

  lock(): void {
    try {
      // Повторный запрос сразу после Esc в Chrome отклоняется: ждём следующего клика.
      const result = this.el.requestPointerLock() as unknown as Promise<void> | undefined
      result?.catch?.(() => {})
    } catch {
      // игнорируем: пользователь кликнет ещё раз
    }
  }
}
