import type { Room, Surface } from '../network/contract'

export type SurfaceKind = 'floor' | 'ceiling' | 'wall' | 'plinth' | 'other'

/** Что за блок сервера — по размерам. Неуверенный случай — `other` (нейтральный материал). */
export function classifySurface(s: Surface, bounds: Room['bounds']): SurfaceKind {
  const bottom = s.position.y - s.size.y / 2
  const top = s.position.y + s.size.y / 2
  if (s.size.y <= 0.3 && top <= 0.05) return 'floor'
  if (s.size.y <= 0.3 && bottom >= bounds.max.y - 0.3) return 'ceiling'
  if (s.size.y >= 2) return 'wall'
  if (s.collidable && s.size.y <= 1.2) return 'plinth'
  return 'other'
}
