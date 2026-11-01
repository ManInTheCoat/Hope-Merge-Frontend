import * as THREE from 'three'
import { canvasTexture } from './canvasTexture'

/**
 * Плоская табличка с текстом; лицевая сторона смотрит в +Z своей системы координат.
 * `accent` — узкая цветная полоса слева (цвет игрока).
 */
export function makeLabel(text: string, widthM: number, accent?: string): THREE.Object3D {
  const texture = canvasTexture(512, 128, (ctx) => {
    ctx.fillStyle = 'rgba(20, 20, 24, 0.75)'
    ctx.fillRect(0, 0, 512, 128)
    if (accent) {
      ctx.fillStyle = accent
      ctx.fillRect(0, 0, 14, 128)
    }
    ctx.fillStyle = '#f4efe6'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    let size = 56
    do {
      ctx.font = `bold ${size}px sans-serif`
      size -= 4
    } while (ctx.measureText(text).width > 512 - 32 && size > 16)
    ctx.fillText(text, 256, 64)
  })
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(widthM, widthM / 4),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }),
  )
  return mesh
}

/** Табличка гида: имя крупно, подпись мельче второй строкой; цветная полоса слева. */
export function makeGuideLabel(name: string, subtitle: string, widthM: number, accent: string): THREE.Mesh {
  const W = 512
  const H = subtitle ? 176 : 128
  const fit = (ctx: CanvasRenderingContext2D, text: string, start: number, weight: string) => {
    let size = start
    do {
      ctx.font = `${weight} ${size}px sans-serif`
      size -= 2
    } while (ctx.measureText(text).width > W - 48 && size > 14)
  }
  const texture = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = 'rgba(20, 20, 24, 0.8)'
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = accent
    ctx.fillRect(0, 0, 14, H)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#f4efe6'
    fit(ctx, name, 56, 'bold')
    ctx.fillText(name, W / 2 + 7, 64)
    if (subtitle) {
      ctx.fillStyle = '#c9c3b8'
      fit(ctx, subtitle, 32, 'normal')
      ctx.fillText(subtitle, W / 2 + 7, 136)
    }
  })
  return new THREE.Mesh(
    new THREE.PlaneGeometry(widthM, (widthM * H) / W),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }),
  )
}
