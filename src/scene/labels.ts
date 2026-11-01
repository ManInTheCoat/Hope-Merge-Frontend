import * as THREE from 'three'
import { canvasTexture } from './canvasTexture'

/** Плоская табличка с текстом; лицевая сторона смотрит в +Z своей системы координат. */
export function makeLabel(text: string, widthM: number): THREE.Object3D {
  const texture = canvasTexture(512, 128, (ctx) => {
    ctx.fillStyle = 'rgba(20, 20, 24, 0.75)'
    ctx.fillRect(0, 0, 512, 128)
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
    new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
  )
  return mesh
}
