import { expect, test } from 'bun:test'
import { classifySurface } from '../src/scene/surfaceKind'
import type { Surface } from '../src/network/contract'

const bounds = { min: { x: -6, y: 0, z: -8 }, max: { x: 6, y: 4, z: 8 } }
const s = (y: number, h: number, collidable: boolean, w = 1, d = 1): Surface => ({
  id: 'x', position: { x: 0, y, z: 0 }, size: { x: w, y: h, z: d }, color: '#ffffff', collidable,
})

test('classifySurface: пол, потолок, стена, постамент, прочее', () => {
  expect(classifySurface(s(-0.05, 0.1, false, 12, 16), bounds)).toBe('floor')
  expect(classifySurface(s(4.05, 0.1, false, 12, 16), bounds)).toBe('ceiling')
  expect(classifySurface(s(2, 4, true, 12, 0.2), bounds)).toBe('wall')
  expect(classifySurface(s(0.225, 0.45, true, 2, 0.5), bounds)).toBe('plinth')
  expect(classifySurface(s(0.225, 0.45, false, 2, 0.5), bounds)).toBe('other')
  expect(classifySurface(s(1.5, 3, true, 0.1, 4), bounds)).toBe('wall')
})
