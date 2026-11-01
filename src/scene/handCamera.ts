import * as THREE from 'three'
import { canvasTexture } from './canvasTexture'
import { HAND_BASE, handPose } from './handPose'

/** Лампа в левой руке относительно камеры игрока (м). */
const LAMP_HAND = { x: -0.19, y: -0.2, z: -0.5 }

/** Размеры корпуса, м. */
const BODY = { w: 0.13, h: 0.082, d: 0.046 }

function texture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const t = canvasTexture(width, height, draw)
  t.anisotropy = 4
  return t
}

/** Повторяемое зерно, чтобы текстуры были одинаковыми при каждом запуске. */
function grain(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
}

function drawLeather(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#1d1c1f'
  ctx.fillRect(0, 0, w, h)
  const rnd = grain(7)
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * w
    const y = rnd() * h
    const r = 0.6 + rnd() * 1.6
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.35)'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** Кожзам по бокам и спереди. */
const leatherTexture = () => texture(256, 256, (ctx) => drawLeather(ctx, 256, 256))

/**
 * Задняя панель: кожзам с декоративным «экраном». Экран не настоящий: стекло с градиентом, бликом,
 * сеткой третей и парой значков, без изображения с камеры.
 */
const backTexture = () =>
  texture(512, 324, (ctx) => {
    const W = 512
    const H = 324
    drawLeather(ctx, W, H)

    const sx = 38
    const sy = 40
    const sw = 300
    const sh = 228
    const r = 14
    // Рамка экрана.
    ctx.fillStyle = '#0b0b0d'
    ctx.beginPath()
    ctx.roundRect(sx - 8, sy - 8, sw + 16, sh + 16, r + 6)
    ctx.fill()
    // Стекло.
    const glass = ctx.createLinearGradient(sx, sy, sx + sw, sy + sh)
    glass.addColorStop(0, '#1d3b52')
    glass.addColorStop(0.55, '#10202f')
    glass.addColorStop(1, '#2a1f3a')
    ctx.fillStyle = glass
    ctx.beginPath()
    ctx.roundRect(sx, sy, sw, sh, r)
    ctx.fill()
    ctx.save()
    ctx.clip()
    // Сетка третей.
    ctx.strokeStyle = 'rgba(200, 225, 255, 0.16)'
    ctx.lineWidth = 1.5
    for (let i = 1; i < 3; i++) {
      ctx.beginPath()
      ctx.moveTo(sx + (sw * i) / 3, sy)
      ctx.lineTo(sx + (sw * i) / 3, sy + sh)
      ctx.moveTo(sx, sy + (sh * i) / 3)
      ctx.lineTo(sx + sw, sy + (sh * i) / 3)
      ctx.stroke()
    }
    // Рамка фокуса по центру.
    ctx.strokeStyle = 'rgba(140, 230, 170, 0.75)'
    ctx.lineWidth = 3
    const fx = sx + sw / 2
    const fy = sy + sh / 2
    const c = 16
    for (const [dx, dy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      ctx.beginPath()
      ctx.moveTo(fx + dx * 26, fy + dy * (26 - c))
      ctx.lineTo(fx + dx * 26, fy + dy * 26)
      ctx.lineTo(fx + dx * (26 - c), fy + dy * 26)
      ctx.stroke()
    }
    // Значки: батарея и счётчик кадров.
    ctx.fillStyle = 'rgba(230, 240, 255, 0.8)'
    ctx.strokeStyle = 'rgba(230, 240, 255, 0.8)'
    ctx.lineWidth = 2
    ctx.strokeRect(sx + sw - 52, sy + 16, 30, 14)
    ctx.fillRect(sx + sw - 22, sy + 20, 4, 6)
    ctx.fillRect(sx + sw - 49, sy + 19, 18, 8)
    ctx.font = 'bold 18px sans-serif'
    ctx.textBaseline = 'top'
    ctx.fillText('[ 24 ]', sx + 14, sy + sh - 32)
    // Блик по диагонали.
    const glare = ctx.createLinearGradient(sx, sy, sx + sw * 0.6, sy + sh)
    glare.addColorStop(0, 'rgba(255,255,255,0.22)')
    glare.addColorStop(0.35, 'rgba(255,255,255,0.05)')
    glare.addColorStop(0.36, 'rgba(255,255,255,0)')
    ctx.fillStyle = glare
    ctx.fillRect(sx, sy, sw, sh)
    ctx.restore()

    // Кнопки справа от экрана.
    const bx = 410
    for (const [y, rr] of [
      [80, 18],
      [150, 26],
      [225, 14],
    ]) {
      const g = ctx.createRadialGradient(bx - rr / 3, y - rr / 3, 2, bx, y, rr)
      g.addColorStop(0, '#5a5a60')
      g.addColorStop(1, '#151517')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(bx, y, rr, 0, Math.PI * 2)
      ctx.fill()
    }
  })

/** Насечка на кольце объектива. */
const knurlTexture = () =>
  texture(256, 32, (ctx) => {
    ctx.fillStyle = '#2b2b2f'
    ctx.fillRect(0, 0, 256, 32)
    ctx.fillStyle = '#121214'
    for (let x = 0; x < 256; x += 6) ctx.fillRect(x, 0, 3, 32)
  })

/** Стекло объектива: тёмные кольца с цветным отблеском просветления. */
const glassTexture = () =>
  texture(128, 128, (ctx) => {
    const g = ctx.createRadialGradient(54, 50, 4, 64, 64, 64)
    g.addColorStop(0, '#6a5cff')
    g.addColorStop(0.18, '#1d2a55')
    g.addColorStop(0.6, '#07080d')
    g.addColorStop(1, '#000000')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
    ctx.strokeStyle = 'rgba(160, 200, 255, 0.25)'
    ctx.lineWidth = 2
    for (const r of [22, 38, 52]) {
      ctx.beginPath()
      ctx.arc(64, 64, r, 0, Math.PI * 2)
      ctx.stroke()
    }
  })

/**
 * Фотоаппарат в руке игрока — только у него на экране. Рисуется отдельным проходом поверх зала
 * (после очистки глубины), поэтому не уходит в стены и не попадает в снимок: снимок рисует только зал.
 */
export class HandCamera {
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.01, 2)
  private readonly rig = new THREE.Group()
  private readonly shutter: THREE.Mesh
  private readonly lampRig = new THREE.Group()
  private readonly lampModel = new THREE.Group()
  private readonly lampBulb: THREE.MeshStandardMaterial
  private shotAt: number | null = null
  visible = false

  constructor() {
    this.scene.add(new THREE.HemisphereLight(0xfff4e6, 0x3a3028, 1.4))
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(-0.6, 1, 0.8)
    this.scene.add(key)

    const leather = new THREE.MeshStandardMaterial({ map: leatherTexture(), roughness: 0.85 })
    const back = new THREE.MeshStandardMaterial({ map: backTexture(), roughness: 0.4 })
    const chrome = new THREE.MeshStandardMaterial({ color: '#c9c9ce', metalness: 0.55, roughness: 0.28 })
    const dark = new THREE.MeshStandardMaterial({ color: '#141416', roughness: 0.5 })
    const knurl = new THREE.MeshStandardMaterial({ map: knurlTexture(), roughness: 0.6 })
    const glass = new THREE.MeshStandardMaterial({ map: glassTexture(), roughness: 0.08, metalness: 0.2 })
    const red = new THREE.MeshStandardMaterial({ color: '#b3261e', roughness: 0.4 })

    const model = new THREE.Group()
    // Корпус: грани +X, −X, +Y, −Y, +Z (к игроку), −Z (к объективу).
    model.add(
      new THREE.Mesh(new THREE.BoxGeometry(BODY.w, BODY.h, BODY.d), [leather, leather, chrome, dark, back, leather]),
    )
    // Хромированная верхняя планка с выступом видоискателя.
    const plate = new THREE.Mesh(new THREE.BoxGeometry(BODY.w, 0.012, BODY.d + 0.002), chrome)
    plate.position.y = BODY.h / 2 + 0.006
    model.add(plate)
    const finder = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.022, 0.034), chrome)
    finder.position.set(-0.022, BODY.h / 2 + 0.022, 0)
    model.add(finder)
    const finderGlass = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.01, 0.002), dark)
    finderGlass.position.set(-0.022, BODY.h / 2 + 0.024, 0.0175)
    model.add(finderGlass)
    // Диск режимов и кнопка спуска.
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.008, 24), [knurl, chrome, chrome])
    dial.position.set(0.03, BODY.h / 2 + 0.016, -0.004)
    model.add(dial)
    this.shutter = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0065, 0.006, 20), red)
    this.shutter.position.set(0.052, BODY.h / 2 + 0.015, 0.006)
    model.add(this.shutter)
    // Объектив: тубус, кольцо с насечкой, передняя линза.
    const lens = new THREE.Group()
    lens.rotation.x = Math.PI / 2
    lens.position.set(0.012, -0.004, -BODY.d / 2)
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.028, 0.03, 32), dark)
    barrel.position.y = 0.015
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.029, 0.014, 32, 1, true), knurl)
    ring.position.y = 0.022
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.004, 32), [chrome, glass, chrome])
    rim.position.y = 0.032
    lens.add(barrel, ring, rim)
    model.add(lens)
    // Ушко ремешка.
    const lug = new THREE.Mesh(new THREE.TorusGeometry(0.005, 0.0015, 8, 16), chrome)
    lug.position.set(-BODY.w / 2 - 0.002, BODY.h / 2 - 0.01, 0)
    lug.rotation.y = Math.PI / 2
    model.add(lug)

    // Аппарат чуть повёрнут к центру, чтобы был виден объектив.
    model.rotation.set(0.1, 0.3, -0.05)
    this.rig.add(model)
    this.scene.add(this.rig)

    // Лампа в левой руке: ручка и раструб с линзой, смотрит вперёд-вниз, как её свет в зале.
    const metal = new THREE.MeshStandardMaterial({ color: '#3a3a3f', roughness: 0.45, metalness: 0.5 })
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.019, 0.17, 16), metal)
    handle.position.set(0, -0.06, 0.05)
    handle.rotation.x = -0.35
    const shade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.036, 0.1, 24, 1, true),
      new THREE.MeshStandardMaterial({ color: '#3a3a3f', roughness: 0.45, metalness: 0.5, side: THREE.DoubleSide }),
    )
    shade.rotation.x = -Math.PI / 2
    shade.position.set(0, 0.02, -0.04)
    this.lampBulb = new THREE.MeshStandardMaterial({ color: '#fff3d6', emissive: '#fff3d6', emissiveIntensity: 1 })
    const lampLens = new THREE.Mesh(new THREE.CircleGeometry(0.056, 24), this.lampBulb)
    lampLens.rotation.y = Math.PI
    lampLens.position.set(0, 0.02, -0.09)
    this.lampModel.add(handle, shade, lampLens)
    this.lampModel.rotation.x = -0.25
    this.lampModel.scale.setScalar(0.65)
    this.lampRig.add(this.lampModel)
    this.lampRig.visible = false
    this.scene.add(this.lampRig)
  }

  /** Лампа в руке: true — показать (включена или нет), false — убрать. */
  setLamp(held: boolean, on: boolean): void {
    this.lampRig.visible = held
    this.lampBulb.emissiveIntensity = on ? 1 : 0.05
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }

  /** Спуск затвора: кнопка нажимается, аппарат вздрагивает. */
  shoot(now: number): void {
    this.shotAt = now
  }

  /** `walking` — 0…1, доля от полной скорости ходьбы. */
  update(now: number, walking: number): void {
    const p = handPose({ timeS: now / 1000, walking, sinceShotMs: this.shotAt === null ? null : now - this.shotAt })
    this.rig.position.set(p.x, p.y, p.z)
    this.rig.rotation.set(p.pitch, 0, p.roll)
    this.shutter.position.y = BODY.h / 2 + 0.015 - p.shutter * 0.003
    // Лампа слева, фотоаппарат справа; при ходьбе лампа покачивается вместе с ним.
    this.lampRig.position.set(LAMP_HAND.x, LAMP_HAND.y + (p.y - HAND_BASE.y) * 0.6, LAMP_HAND.z)
  }

  /** Второй проход поверх уже отрисованного зала. */
  render(renderer: THREE.WebGLRenderer): void {
    if (!this.visible) return
    const autoClear = renderer.autoClear
    renderer.autoClear = false
    renderer.clearDepth()
    renderer.render(this.scene, this.camera)
    renderer.autoClear = autoClear
  }
}
