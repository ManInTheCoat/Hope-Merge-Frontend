import * as THREE from 'three'
import './style.css'

if (import.meta.env.VITE_USE_MOCK === 'true') {
  import('./network/mock').then((m) => m.installMocks())
}

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
document.querySelector<HTMLDivElement>('#app')!.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x1a1a1f)

const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100)
camera.position.set(0, 1.6, 0)

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
resize()

renderer.setAnimationLoop(() => renderer.render(scene, camera))
