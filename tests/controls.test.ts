import { expect, test } from 'bun:test'

// bun без DOM: controls вешает обработчики на document и window, этого достаточно EventTarget.
const g = globalThis as Record<string, unknown>
g.document ??= Object.assign(new EventTarget(), { pointerLockElement: null, activeElement: null })
g.window ??= new EventTarget()
g.HTMLInputElement ??= class {}
g.HTMLTextAreaElement ??= class {}

const { FirstPersonControls } = await import('../src/scene/controls')

function keydown(code: string): Event {
  const e = Object.assign(new Event('keydown', { cancelable: true }), { code, repeat: false })
  document.dispatchEvent(e)
  return e
}

test('E вызывает взаимодействие и гасит нажатие: буква не печатается в открывшееся поле', () => {
  const controls = new FirstPersonControls(new EventTarget() as unknown as HTMLElement, () => {})
  let calls = 0
  controls.onInteract = () => calls++
  const e = keydown('KeyE')
  expect(calls).toBe(1)
  expect(e.defaultPrevented).toBe(true)
  controls.enabled = false
})
