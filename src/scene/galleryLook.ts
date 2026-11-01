import * as THREE from 'three'
import type { Surface } from '../network/contract'
import type { SurfaceKind } from './surfaceKind'

/** Оформление зала «белая галерея»: материалы блоков, рамы, световые пятна. Всё рисуется кодом, без файлов. */
export type GalleryLook = {
  surface(kind: SurfaceKind, s: Surface): THREE.Material
  /** Рама с паспарту; лицевая сторона в +Z, картина — в z = 0 перед ней. */
  exhibitFrame(w: number, h: number): THREE.Object3D
  /** Световое пятно на стене за картиной (в её координатах) или null. */
  lightPool(w: number, h: number): THREE.Object3D | null
  dispose(): void
}

/** Шумовая фактура: базовый цвет и мягкие пятна. */
function noiseTexture(size: number, base: string, spots: number, alpha: number, seed: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)
  let r = seed
  const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296)
  for (let i = 0; i < spots; i++) {
    const x = rnd() * size
    const y = rnd() * size
    const rad = 4 + rnd() * size * 0.12
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad)
    const shade = rnd() < 0.5 ? '0,0,0' : '255,255,255'
    g.addColorStop(0, `rgba(${shade},${alpha * rnd()})`)
    g.addColorStop(1, `rgba(${shade},0)`)
    ctx.fillStyle = g
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2)
  }
  // Мелкое зерно.
  const img = ctx.getImageData(0, 0, size, size)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 10
    img.data[i] += n
    img.data[i + 1] += n
    img.data[i + 2] += n
  }
  ctx.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

export function createGalleryLook(): GalleryLook {
  const owned: { dispose(): void }[] = []
  const own = <T extends { dispose(): void }>(x: T): T => {
    owned.push(x)
    return x
  }
  const concrete = own(noiseTexture(256, '#8e8c87', 90, 0.05, 7))
  const plaster = own(noiseTexture(256, '#f3f1ec', 80, 0.03, 13))

  const repeated = (base: THREE.Texture, u: number, v: number) => {
    const t = own(base.clone())
    t.repeat.set(Math.max(1, u), Math.max(1, v))
    return t
  }

  const black = own(new THREE.MeshStandardMaterial({ color: '#151515', roughness: 0.5 }))
  const matte = own(new THREE.MeshStandardMaterial({ color: '#f7f6f2', roughness: 0.95 }))
  const frameGeoms = new Map<string, THREE.BufferGeometry>()
  const box = (w: number, h: number, d: number) => {
    const key = `${w}:${h}:${d}`
    let g = frameGeoms.get(key)
    if (!g) frameGeoms.set(key, (g = own(new THREE.BoxGeometry(w, h, d))))
    return g
  }

  let poolMaterial: THREE.MeshBasicMaterial | null = null
  const poolGeometry = own(new THREE.PlaneGeometry(1, 1))

  return {
    surface(kind, s) {
      switch (kind) {
        case 'floor':
          return own(new THREE.MeshStandardMaterial({ map: repeated(concrete, s.size.x / 3, s.size.z / 3), roughness: 0.4 }))
        case 'ceiling':
          return own(new THREE.MeshStandardMaterial({ color: '#fbfbfa', roughness: 1 }))
        case 'wall':
          return own(
            new THREE.MeshStandardMaterial({
              map: repeated(plaster, Math.max(s.size.x, s.size.z) / 3, s.size.y / 3),
              roughness: 0.9,
            }),
          )
        case 'plinth':
          return own(new THREE.MeshStandardMaterial({ color: '#f4f4f2', roughness: 0.8 }))
        default: {
          // Неопознанный блок: штукатурка с оттенком серверного цвета.
          const m = own(new THREE.MeshStandardMaterial({ map: plaster, roughness: 0.9 }))
          m.color.set(s.color).lerp(new THREE.Color('#ffffff'), 0.5)
          return m
        }
      }
    },
    exhibitFrame(w, h) {
      const g = new THREE.Group()
      const outer = new THREE.Mesh(box(w + 0.22, h + 0.22, 0.03), black)
      outer.position.z = -0.025
      const mat = new THREE.Mesh(box(w + 0.16, h + 0.16, 0.02), matte)
      mat.position.z = -0.012
      g.add(outer, mat)
      return g
    },
    lightPool(w, h) {
      if (!poolMaterial) {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 128
        const ctx = canvas.getContext('2d')!
        const grad = ctx.createRadialGradient(64, 20, 4, 64, 50, 70)
        grad.addColorStop(0, 'rgba(255,236,200,0.28)')
        grad.addColorStop(0.6, 'rgba(255,236,200,0.08)')
        grad.addColorStop(1, 'rgba(255,236,200,0)')
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, 128, 128)
        const t = own(new THREE.CanvasTexture(canvas))
        t.colorSpace = THREE.SRGBColorSpace
        poolMaterial = own(
          new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
        )
      }
      const pool = new THREE.Mesh(poolGeometry, poolMaterial)
      pool.scale.set(w * 1.5, h * 1.8, 1)
      pool.position.set(0, h * 0.25, -0.045)
      return pool
    },
    dispose() {
      owned.forEach((x) => x.dispose())
      owned.length = 0
    },
  }
}
