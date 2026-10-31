import * as THREE from 'three'

/** Плоская табличка с текстом; лицевая сторона смотрит в +Z своей системы координат. */
export function makeLabel(text: string, widthM: number): THREE.Object3D {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'rgba(20, 20, 24, 0.75)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#f4efe6'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  let size = 56
  do {
    ctx.font = `bold ${size}px sans-serif`
    size -= 4
  } while (ctx.measureText(text).width > canvas.width - 32 && size > 16)
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(widthM, widthM / 4),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
  )
  mesh.userData.kind = 'label'
  return mesh
}
