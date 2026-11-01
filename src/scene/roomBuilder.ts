import * as THREE from 'three'
import type { Room, Vec3 } from '../network/contract'
import { closestOnBox, surfacesToColliders, type Aabb, type Bounds2, type Vec2 } from './collision'
import { gestureWeight } from './guideGesture'
import { disposeLabel, makeLabel } from './labels'
import type { GalleryLook } from './galleryLook'
import { createRuntimeView, type PaintingView, type RuntimeView } from './runtimeView'
import { classifySurface } from './surfaceKind'

export type BuiltRoom = {
  group: THREE.Group
  colliders: Aabb[]
  bounds: Bounds2
  /** Гиды зала: каждый кадр поворачиваются к игроку, их таблички — к камере. */
  guides: GuideActor[]
  /** Применение `world.runtime`: отделка, свет, гиды, стенд и лампа. */
  runtime: RuntimeView
  /** Освобождает геометрии, материалы и текстуры. Битмапы закрывает RoomManager.unload(). */
  dispose(): void
}

type LabelFn = (text: string, widthM: number) => THREE.Object3D

/** Фигурка гида в зале. Табличка — дочерний узел `object`. */
export type GuideActor = {
  id: string
  object: THREE.Object3D
  label: THREE.Object3D
  /** `player` — позиция игрока на полу или null, если её нет. */
  update(dtS: number, player: { x: number; z: number } | null): void
  /** Кивок при начале разговора. */
  greet(): void
  /** Жест, пока гид отвечает (от guide.started до terminal); включается и выключается плавно. */
  setGesturing(on: boolean): void
  /** Новое положение и поворот (runtime заменяет базовые). */
  place(position: Vec3, rotationY: number): void
  /** Новая подпись над гидом. */
  rename(displayName: string, subtitle: string): void
  dispose(): void
}

export type GuideFactory = (g: Room['guides'][number], labelFn: LabelFn) => GuideActor

export type BuildOptions = { guideFactory?: GuideFactory; look?: GalleryLook }

/** Простая фигурка гида (капсула и голова): для тестов и пока модели не загрузились. */
function capsuleGuide(g: Room['guides'][number], labelFn: LabelFn): GuideActor {
  const figure = new THREE.Group()
  figure.position.set(g.position.x, g.position.y, g.position.z)
  figure.rotation.y = g.rotation_y
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.9, 4, 12), new THREE.MeshStandardMaterial({ color: '#3f6f8f' }))
  body.position.y = 0.73
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), new THREE.MeshStandardMaterial({ color: '#e8c9a6' }))
  head.position.y = 1.55
  // Правая рука: поднимается и покачивается, пока гид отвечает.
  const arm = new THREE.Group()
  arm.position.set(0.36, 1.25, 0)
  const armMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.5, 4, 8).translate(0, -0.3, 0), new THREE.MeshStandardMaterial({ color: '#3f6f8f' }))
  arm.add(armMesh)
  let gesturing = false
  let weight = 0
  let clock = 0
  const actor: GuideActor = {
    id: g.id,
    object: figure,
    label: labelFn(g.display_name, 1.2),
    update(dtS) {
      weight = gestureWeight(weight, gesturing, dtS)
      clock += dtS
      // Рука вперёд-вверх (взгляд вдоль −Z) и покачивание предплечья.
      arm.rotation.x = -weight * (1.9 + 0.25 * Math.sin(clock * 7))
    },
    greet() {},
    setGesturing(on) {
      gesturing = on
    },
    place(position, rotationY) {
      figure.position.set(position.x, position.y, position.z)
      figure.rotation.y = rotationY
    },
    rename(displayName) {
      const old = actor.label
      actor.label = labelFn(displayName, 1.2)
      actor.label.position.copy(old.position)
      figure.add(actor.label)
      figure.remove(old)
      disposeLabel(old)
    },
    dispose() {},
  }
  actor.label.position.y = 2.0
  figure.add(body, head, arm, actor.label)
  return actor
}

const DOOR_WIDTH = 1.2
const DOOR_HEIGHT = 2.2
const DOOR_DEPTH = 0.05
/** Дальше этого от стены дверь не прижимаем: контент без стены рядом рисуем прямо в точке двери. */
const DOOR_WALL_SEARCH_M = 1.5

/**
 * Точка на грани ближайшей стены и нормаль этой грани в сторону двери (внутрь зала). Стена — блок не ниже
 * двери: к постаменту или скамье дверь не прижимаем.
 */
function doorPlacement(x: number, z: number, colliders: Aabb[], center: Vec2): { point: Vec2; normal: Vec2 } {
  let best: { point: Vec2; normal: Vec2; dist: number } | null = null
  for (const b of colliders) {
    if (b.maxY < DOOR_HEIGHT) continue
    const { x: cx, z: cz } = closestOnBox({ x, z }, b)
    const dist = Math.hypot(x - cx, z - cz)
    if (dist === 0 || dist > DOOR_WALL_SEARCH_M || (best && dist >= best.dist)) continue
    const dx = x - cx
    const dz = z - cz
    const normal = Math.abs(dx) >= Math.abs(dz) ? { x: Math.sign(dx), z: 0 } : { x: 0, z: Math.sign(dz) }
    const point = normal.x !== 0 ? { x: cx, z } : { x, z: cz }
    best = { point, normal, dist }
  }
  if (best) return { point: best.point, normal: best.normal }
  // Стены рядом нет: ставим в точку двери лицом к центру зала.
  const dx = center.x - x
  const dz = center.z - z
  const len = Math.hypot(dx, dz) || 1
  return { point: { x, z }, normal: { x: dx / len, z: dz / len } }
}

/** Плоскость потолка на верхней границе зала, лицом вниз. */
function decorativeCeiling(bounds: Room['bounds'], look: GalleryLook | undefined): THREE.Mesh {
  const w = bounds.max.x - bounds.min.x
  const d = bounds.max.z - bounds.min.z
  const material = look
    ? look.surface('ceiling', {
        id: 'decor_ceiling',
        position: { x: 0, y: bounds.max.y, z: 0 },
        size: { x: w, y: 0, z: d },
        color: '#fbfbfa',
        collidable: false,
      })
    : new THREE.MeshStandardMaterial({ color: '#fbfbfa', roughness: 1 })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material)
  mesh.rotation.x = Math.PI / 2 // нормаль плоскости смотрит вниз
  mesh.position.set((bounds.min.x + bounds.max.x) / 2, bounds.max.y, (bounds.min.z + bounds.max.z) / 2)
  mesh.userData = { kind: 'decor', id: 'ceiling' }
  return mesh
}

export function buildRoom(
  room: Room,
  bitmaps: Map<string, ImageBitmap>,
  labelFn: LabelFn = makeLabel,
  opts: BuildOptions = {},
): BuiltRoom {
  const group = new THREE.Group()
  group.name = room.id

  const look = opts.look
  let ambient: THREE.HemisphereLight
  let sun: THREE.DirectionalLight | undefined
  if (look) {
    // Мягкий общий свет плюс один направленный: без теней, дёшево на встроенной графике.
    ambient = new THREE.HemisphereLight(0xffffff, 0xd9d4ca, 0.8)
    group.add(ambient)
    sun = new THREE.DirectionalLight(0xfff6ea, 1.3)
    sun.position.set(3, 8, 5)
    group.add(sun)
  } else {
    ambient = new THREE.HemisphereLight(0xffffff, 0x887766, 1.6)
    group.add(ambient, new THREE.AmbientLight(0xffffff, 0.6))
  }

  let hasCeiling = false
  const walls: THREE.Mesh[] = []
  for (const s of room.surfaces) {
    const kind = classifySurface(s, room.bounds)
    if (kind === 'ceiling') hasCeiling = true
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(s.size.x, s.size.y, s.size.z),
      look ? look.surface(kind, s) : new THREE.MeshStandardMaterial({ color: s.color }),
    )
    mesh.position.set(s.position.x, s.position.y, s.position.z)
    mesh.userData = { kind: 'surface', id: s.id }
    if (kind === 'wall') walls.push(mesh)
    group.add(mesh)
  }

  // В настоящих залах блока-потолка нет: рисуем декоративный по bounds. Это только картинка — не поверхность
  // сервера, коллайдера у неё нет.
  if (!hasCeiling) group.add(decorativeCeiling(room.bounds, look))

  const paintings: PaintingView[] = []
  for (const e of room.exhibits) {
    const bitmap = bitmaps.get(e.image_asset_id)
    let material: THREE.MeshBasicMaterial
    if (bitmap) {
      const texture = new THREE.Texture(bitmap)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.flipY = false // ImageBitmap уже перевёрнут при декодировании, UNPACK_FLIP_Y для него не действует
      texture.needsUpdate = true
      // Картина показывается как есть: тонмаппинг сцены не должен гасить её цвета.
      material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
    } else {
      material = new THREE.MeshBasicMaterial({ color: '#777777' })
    }
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(e.width_m, e.height_m), material)
    mesh.position.set(e.position.x, e.position.y, e.position.z)
    mesh.rotation.y = e.rotation_y
    mesh.userData = { kind: 'exhibit', id: e.id }
    paintings.push({ material, position: { x: e.position.x, y: e.position.y, z: e.position.z }, rotation_y: e.rotation_y })

    if (look) {
      mesh.add(look.exhibitFrame(e.width_m, e.height_m))
      const pool = look.lightPool(e.width_m, e.height_m)
      if (pool) mesh.add(pool)
    } else {
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(e.width_m + 0.16, e.height_m + 0.16, 0.04),
        new THREE.MeshStandardMaterial({ color: '#3b2f25' }),
      )
      frame.position.z = -0.03
      mesh.add(frame)
    }

    group.add(mesh)
  }

  const colliders = surfacesToColliders(room.surfaces)
  const center = { x: (room.bounds.min.x + room.bounds.max.x) / 2, z: (room.bounds.min.z + room.bounds.max.z) / 2 }
  for (const d of room.doors) {
    // Позиция двери — точка взаимодействия перед стеной (api.md); саму дверь ставим на ближайшую стену.
    const { point, normal } = doorPlacement(d.position.x, d.position.z, colliders, center)
    const door = new THREE.Group()
    door.userData = { kind: 'door', id: d.id }
    door.position.set(point.x, 0, point.z)
    door.rotation.y = Math.atan2(normal.x, normal.z) // локальная +Z смотрит внутрь зала

    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(DOOR_WIDTH, DOOR_HEIGHT, DOOR_DEPTH),
      new THREE.MeshStandardMaterial({ color: '#2a211b' }),
    )
    panel.position.set(0, DOOR_HEIGHT / 2, DOOR_DEPTH / 2)
    const label = labelFn(d.label, 1.8)
    label.position.set(0, DOOR_HEIGHT + 0.4, DOOR_DEPTH + 0.01)
    door.add(panel, label)
    group.add(door)
  }

  const guides: GuideActor[] = []
  for (const g of room.guides) {
    const actor = (opts.guideFactory ?? capsuleGuide)(g, labelFn)
    actor.object.userData = { kind: 'guide', id: g.id }
    guides.push(actor)
    group.add(actor.object)
  }

  const runtime = createRuntimeView({ group, bounds: room.bounds, walls, ambient, sun, paintings, guides, textured: !!look })

  return {
    group,
    runtime,
    colliders,
    bounds: { minX: room.bounds.min.x, maxX: room.bounds.max.x, minZ: room.bounds.min.z, maxZ: room.bounds.max.z },
    guides,
    dispose() {
      runtime.dispose()
      for (const a of guides) a.dispose()
      look?.dispose()
      group.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.geometry.dispose()
        for (const mat of [mesh.material].flat()) {
          ;(mat as THREE.MeshBasicMaterial).map?.dispose()
          mat.dispose()
        }
      })
      group.clear()
    },
  }
}
