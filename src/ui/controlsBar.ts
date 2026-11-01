const KEYS: [string, string][] = [
  ['WASD', 'идти'],
  ['E', 'осмотр'],
  ['F', 'фото'],
  ['G', 'скачать'],
  ['B', 'альбом'],
  ['Enter', 'чат'],
  ['Esc', 'мышь'],
]

/** Постоянная строка подсказок управления внизу по центру. */
export function createControlsBar(host: HTMLElement): { setVisible(v: boolean): void } {
  const bar = document.createElement('div')
  bar.className = 'hud-controls'
  bar.hidden = true
  KEYS.forEach(([key, action], i) => {
    const item = document.createElement('span')
    item.className = 'hud-controls-item'
    const kbd = document.createElement('kbd')
    kbd.textContent = key
    item.append(kbd, ` ${action}`)
    if (i < KEYS.length - 1) item.append(' ·')
    bar.appendChild(item)
  })
  host.appendChild(bar)

  let visible = false
  return {
    setVisible(v) {
      if (v === visible) return // вызывается каждый кадр
      visible = v
      bar.hidden = !v
    },
  }
}
