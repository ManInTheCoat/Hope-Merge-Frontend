import type { SundayClientMetric } from '../network/sunday'

export type ClientRow = { name: string; room: string; fps: string; ping: string }

const NO_DATA = 'нет данных'

/** Строка таблицы «Клиенты»: протухшие данные и скрытая вкладка не выглядят как FPS 0. */
export function clientRow(c: SundayClientMetric): ClientRow {
  let fps: string
  if (c.stale || (c.fps === null && c.visible)) fps = NO_DATA
  else if (!c.visible || c.fps === null) fps = 'скрыта'
  else fps = Number.isInteger(c.fps) ? String(c.fps) : c.fps.toFixed(1)
  return {
    name: c.display_name,
    room: c.room_id,
    fps,
    ping: c.ping_ms === null ? '—' : `${c.ping_ms} мс`,
  }
}
