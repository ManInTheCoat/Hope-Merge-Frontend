import * as THREE from 'three'
import { canvasTexture } from './canvasTexture'

/** Габариты стенда «Цвет и свет», м: ширина × высота × глубина (api-sunday.md §2). */
export const STAND_SIZE = { x: 1, y: 1.5, z: 0.5 }
/** Положение стенда относительно угла зала (bounds.min): у настоящих залов 12×12 это точка (6, 0, 3). */
export const STAND_OFFSET = { x: 6, z: 3 }
const SWAY_AMPLITUDE = 0.35
const SWAY_SPEED = 1.1

export type InstallationView = {
  object: THREE.Group
  update(dtS: number): void
  dispose(): void
}

/** Поворотный стенд «Цвет и свет»: основание и две цветные створки. Покачивание створок — только на клиенте. */
export function createInstallation(): InstallationView {
  const owned: { dispose(): void }[] = []
  const own = <T extends { dispose(): void }>(x: T): T => (owned.push(x), x)
  const baseH = 0.2
  const leafH = STAND_SIZE.y - baseH
  const leafW = STAND_SIZE.x / 2 - 0.04

  const object = new THREE.Group()
  object.name = 'installation'
  const base = new THREE.Mesh(
    own(new THREE.BoxGeometry(STAND_SIZE.x, baseH, STAND_SIZE.z)),
    own(new THREE.MeshStandardMaterial({ color: '#2e2a27', roughness: 0.6 })),
  )
  base.position.y = baseH / 2
  // Табличка на обеих длинных гранях основания, чтобы стенд читался как экспонат.
  // Без DOM (тесты в bun) табличка остаётся гладкой.
  const plateTexture =
    typeof document === 'undefined'
      ? null
      : own(
          canvasTexture(256, 48, (ctx) => {
            ctx.fillStyle = '#b8975a'
            ctx.fillRect(0, 0, 256, 48)
            ctx.fillStyle = '#2a2118'
            ctx.font = 'bold 26px sans-serif'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText('Цвет и свет', 128, 26)
          }),
        )
  const plateGeometry = own(new THREE.PlaneGeometry(STAND_SIZE.x * 0.7, baseH * 0.6))
  const plateMaterial = own(new THREE.MeshStandardMaterial({ map: plateTexture, color: plateTexture ? '#ffffff' : '#b8975a', roughness: 0.4, metalness: 0.3 }))
  const front = new THREE.Mesh(plateGeometry, plateMaterial)
  front.position.z = STAND_SIZE.z / 2 + 0.002
  const back = new THREE.Mesh(plateGeometry, plateMaterial)
  back.position.z = -STAND_SIZE.z / 2 - 0.002
  back.rotation.y = Math.PI
  // Центральная стойка, на которой поворачиваются створки.
  const metal = own(new THREE.MeshStandardMaterial({ color: '#b9b9bf', metalness: 0.6, roughness: 0.3 }))
  const pole = new THREE.Mesh(own(new THREE.CylinderGeometry(0.012, 0.012, leafH, 10)), metal)
  pole.position.y = baseH / 2 + leafH / 2
  base.add(front, back, pole)
  object.add(base)

  // Створки — цветные стёкла в тонкой рамке: на свет видно оттенок, но зал за ними не закрыт.
  const leafGeometry = own(new THREE.BoxGeometry(leafW, leafH, 0.02))
  const frameGeometry = own(new THREE.EdgesGeometry(leafGeometry))
  const frameMaterial = own(new THREE.LineBasicMaterial({ color: '#d8d8dc' }))
  const leaves = ['#e07f6f', '#6fa6dc'].map((color, i) => {
    // Шарнир в центре стенда; створка отнесена на половину ширины от него.
    const hinge = new THREE.Group()
    hinge.position.set(0, baseH, 0)
    const glass = own(
      new THREE.MeshStandardMaterial({ color, roughness: 0.15, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
    )
    const leaf = new THREE.Mesh(leafGeometry, glass)
    leaf.position.set((i === 0 ? -1 : 1) * (leafW / 2 + 0.02), leafH / 2, 0)
    leaf.add(new THREE.LineSegments(frameGeometry, frameMaterial))
    hinge.add(leaf)
    object.add(hinge)
    return hinge
  })

  let t = 0
  return {
    object,
    update(dtS) {
      t += dtS
      const sway = Math.sin(t * SWAY_SPEED) * SWAY_AMPLITUDE
      leaves[0].rotation.y = sway
      leaves[1].rotation.y = -sway
    },
    dispose() {
      owned.forEach((x) => x.dispose())
      owned.length = 0
    },
  }
}
