import * as THREE from 'three'
import type { Accessory } from './catalog'

// Общие на всю страницу: несколько примитивов, освобождать при смене зала не нужно.
const straw = new THREE.MeshStandardMaterial({ color: '#e3c77a', roughness: 0.9 })
const band = new THREE.MeshStandardMaterial({ color: '#2a2a2a', roughness: 0.8 })
const beretMat = new THREE.MeshStandardMaterial({ color: '#2b2622', roughness: 0.95 })
const cyl = (rTop: number, rBottom: number, h: number) => new THREE.CylinderGeometry(rTop, rBottom, h, 24)
const geo = {
  boaterBrim: cyl(0.36, 0.36, 0.02),
  boaterCrown: cyl(0.25, 0.25, 0.12),
  boaterBand: cyl(0.255, 0.255, 0.035),
  wideBrim: cyl(0.46, 0.46, 0.02),
  wideCrown: cyl(0.2, 0.26, 0.16),
  beret: new THREE.SphereGeometry(0.29, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.35, 1),
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const out = new THREE.Mesh(g, m)
  out.position.set(x, y, z)
  return out
}

/**
 * Деталь из примитивов в координатах кости головы модели Kenney (лицо смотрит в +Z).
 * `headTop` — макушка относительно кости; шляпа садится чуть ниже, на волосы.
 */
export function buildAccessory(kind: Accessory, headTop: number): THREE.Object3D {
  const g = new THREE.Group()
  headTop -= 0.04
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
  }
  return g
}
