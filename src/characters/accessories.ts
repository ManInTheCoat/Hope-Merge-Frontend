import * as THREE from 'three'
import type { Accessory } from './catalog'

// Общие на всю страницу: несколько примитивов, освобождать при смене зала не нужно.
const straw = new THREE.MeshStandardMaterial({ color: '#e3c77a', roughness: 0.9 })
const band = new THREE.MeshStandardMaterial({ color: '#2a2a2a', roughness: 0.8 })
const beretMat = new THREE.MeshStandardMaterial({ color: '#2b2622', roughness: 0.95 })
const beards: Record<'beard-white' | 'beard-grey' | 'beard-red', THREE.MeshStandardMaterial> = {
  'beard-white': new THREE.MeshStandardMaterial({ color: '#f1efe8', roughness: 1 }),
  'beard-grey': new THREE.MeshStandardMaterial({ color: '#b9b5ad', roughness: 1 }),
  'beard-red': new THREE.MeshStandardMaterial({ color: '#c0562a', roughness: 1 }),
}
const cyl = (rTop: number, rBottom: number, h: number) => new THREE.CylinderGeometry(rTop, rBottom, h, 24)
const geo = {
  boaterBrim: cyl(0.36, 0.36, 0.02),
  boaterCrown: cyl(0.25, 0.25, 0.12),
  boaterBand: cyl(0.255, 0.255, 0.035),
  wideBrim: cyl(0.46, 0.46, 0.02),
  wideCrown: cyl(0.2, 0.26, 0.16),
  beret: new THREE.SphereGeometry(0.29, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.35, 1),
  beardShort: new THREE.BoxGeometry(0.3, 0.11, 0.06),
  beardLong: new THREE.BoxGeometry(0.3, 0.2, 0.06),
  moustache: new THREE.BoxGeometry(0.2, 0.035, 0.04),
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const out = new THREE.Mesh(g, m)
  out.position.set(x, y, z)
  return out
}

/**
 * Деталь из примитивов в координатах кости головы модели Kenney (лицо смотрит в +Z).
 * `headTop`/`headBottom` — макушка и подбородок относительно кости, `faceZ` — передняя грань лица.
 */
export function buildAccessory(kind: Accessory, headTop: number, headBottom: number, faceZ: number): THREE.Object3D {
  const g = new THREE.Group()
  switch (kind) {
    case 'boater':
      g.add(mesh(geo.boaterBrim, straw, 0, headTop, 0.02), mesh(geo.boaterCrown, straw, 0, headTop + 0.07, 0.02))
      g.add(mesh(geo.boaterBand, band, 0, headTop + 0.035, 0.02))
      break
    case 'straw-wide':
      g.add(mesh(geo.wideBrim, straw, 0, headTop, 0.02), mesh(geo.wideCrown, straw, 0, headTop + 0.09, 0.02))
      break
    case 'beret': {
      const b = mesh(geo.beret, beretMat, 0.03, headTop - 0.02, 0)
      b.rotation.z = -0.25
      g.add(b)
      break
    }
    case 'beard-white':
    case 'beard-grey':
    case 'beard-red': {
      const m = beards[kind]
      const long = kind !== 'beard-red'
      // Борода растёт от нижней части лица вниз, усы — чуть выше неё.
      const top = headBottom + 0.12
      const h = long ? 0.2 : 0.11
      g.add(mesh(long ? geo.beardLong : geo.beardShort, m, 0, top - h / 2, faceZ + 0.02))
      g.add(mesh(geo.moustache, m, 0, top + 0.01, faceZ + 0.025))
      break
    }
  }
  return g
}
