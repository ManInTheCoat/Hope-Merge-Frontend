import * as THREE from 'three'

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
    own(new THREE.MeshStandardMaterial({ color: '#3a3a3d', roughness: 0.7 })),
  )
  base.position.y = baseH / 2
  object.add(base)

  const leafGeometry = own(new THREE.BoxGeometry(leafW, leafH, 0.04))
  const leaves = ['#c0504d', '#4a7fb5'].map((color, i) => {
    // Шарнир в центре стенда; створка отнесена на половину ширины от него.
    const hinge = new THREE.Group()
    hinge.position.set(0, baseH, 0)
    const leaf = new THREE.Mesh(leafGeometry, own(new THREE.MeshStandardMaterial({ color, roughness: 0.6 })))
    leaf.position.set((i === 0 ? -1 : 1) * (leafW / 2 + 0.02), leafH / 2, 0)
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
