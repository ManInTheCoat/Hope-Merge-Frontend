import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { MODEL_IDS } from './catalog'

/** Рост фигурки, м: чуть ниже цилиндра игрока (1,8 м), голова около камеры 1,65 м. */
const FIGURE_HEIGHT_M = 1.75

type Template = { scene: THREE.Object3D; clips: Map<string, THREE.AnimationClip>; scale: number }

/** Фигурка-экземпляр: свой скелет и миксер, геометрии, материалы и клипы общие с библиотекой. */
export class Figure {
  readonly root = new THREE.Group()
  readonly head: THREE.Object3D | null
  readonly torso: THREE.Object3D | null
  /** Меш тела (без головы) — его материал можно перекрасить под одежду. */
  readonly bodyMesh: THREE.Mesh | null
  private readonly mixer: THREE.AnimationMixer
  private readonly clips: Map<string, THREE.AnimationClip>
  private current: THREE.AnimationAction | null = null
  private currentName = ''
  private ownMaterial: THREE.Material | null = null

  constructor(t: Template) {
    const model = cloneSkinned(t.scene)
    model.scale.setScalar(t.scale)
    // Модели Kenney смотрят в +Z, а взгляд игрока при yaw = 0 — вдоль −Z.
    model.rotation.y = Math.PI
    this.root.add(model)
    this.head = model.getObjectByName('head') ?? null
    this.torso = model.getObjectByName('torso') ?? null
    this.bodyMesh = (model.getObjectByName('body-mesh') as THREE.Mesh | undefined) ?? null
    this.mixer = new THREE.AnimationMixer(model)
    this.clips = t.clips
    this.play('idle', 0)
  }

  play(name: string, fadeS = 0.2, once = false): void {
    if (name === this.currentName && !once) return
    const clip = this.clips.get(name)
    if (!clip) return
    const next = this.mixer.clipAction(clip)
    next.reset()
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity)
    next.clampWhenFinished = once
    next.play()
    if (this.current && this.current !== next) this.current.crossFadeTo(next, fadeS, false)
    this.current = next
    this.currentName = name
  }

  /** Проигрывается ли сейчас разовый клип, который ещё не закончился. */
  get busy(): boolean {
    return !!this.current && this.current.loop === THREE.LoopOnce && this.current.isRunning()
  }

  /** Перекраска одежды: тонирует текстуру-палитру тела, голова остаётся прежней. */
  tintBody(color: string): void {
    if (!this.bodyMesh) return
    const m = (this.bodyMesh.material as THREE.MeshStandardMaterial).clone()
    m.color.set(color)
    this.bodyMesh.material = m
    this.ownMaterial = m
  }

  update(dtS: number): void {
    this.mixer.update(dtS)
  }

  dispose(): void {
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.mixer.getRoot())
    this.ownMaterial?.dispose()
    this.root.removeFromParent()
  }
}

/** Модели персонажей: статика клиента, грузится один раз за сеанс страницы (не контент мира). */
export class CharacterLibrary {
  private readonly templates: Map<string, Template>
  private constructor(templates: Map<string, Template>) {
    this.templates = templates
  }

  static async load(base = '/characters/'): Promise<CharacterLibrary> {
    const loader = new GLTFLoader()
    const entries = await Promise.all(
      MODEL_IDS.map(async (id) => {
        const gltf = await loader.loadAsync(`${base}${id}.glb`)
        const box = new THREE.Box3().setFromObject(gltf.scene)
        const height = box.max.y - box.min.y || 1
        const clips = new Map(gltf.animations.map((c) => [c.name, c]))
        return [id, { scene: gltf.scene, clips, scale: FIGURE_HEIGHT_M / height }] as const
      }),
    )
    return new CharacterLibrary(new Map(entries))
  }

  has(model: string): boolean {
    return this.templates.has(model)
  }

  create(model: string): Figure {
    const t = this.templates.get(model) ?? this.templates.values().next().value!
    return new Figure(t)
  }
}

let shadowGeometry: THREE.PlaneGeometry | null = null
let shadowMaterial: THREE.MeshBasicMaterial | null = null

/** Мягкое пятно-тень под ногами: вместо shadow map, ничего не стоит. Ресурсы общие на всю страницу. */
export function blobShadow(): THREE.Mesh {
  if (!shadowGeometry || !shadowMaterial) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 64
    const ctx = canvas.getContext('2d')!
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    g.addColorStop(0, 'rgba(0,0,0,0.45)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 64, 64)
    shadowGeometry = new THREE.PlaneGeometry(0.8, 0.8).rotateX(-Math.PI / 2)
    shadowMaterial = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false })
  }
  const mesh = new THREE.Mesh(shadowGeometry, shadowMaterial)
  mesh.position.y = 0.01
  mesh.renderOrder = -1
  return mesh
}
