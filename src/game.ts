import * as THREE from 'three'
import { fetchAssetBlob, fetchManifest, fetchRoomText } from './network/api'
import type { ErrorBody, Exhibit, Manifest } from './network/contract'
import { ensureDevSession } from './network/devAuth'
import { GameSocket } from './network/ws'
import { moveCylinder, type Vec2 } from './scene/collision'
import { FirstPersonControls } from './scene/controls'
import { moveVector } from './scene/input'
import { buildRoom, type BuiltRoom } from './scene/roomBuilder'
import { pickExhibit } from './scene/targeting'
import { createHud } from './ui/hud'
import { RoomManager } from './world/RoomManager'

const MOVE_SEND_INTERVAL_MS = 100
const MAX_FRAME_DT = 0.1

type Session = {
  ac: AbortController
  socket: GameSocket | null
  manifest: Manifest | null
  built: BuiltRoom | null
  exhibits: Exhibit[]
  pos: Vec2
  epoch: number
  seq: number
  ready: boolean
  moveTimer: ReturnType<typeof setInterval> | null
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  const body = e as Partial<ErrorBody> | null
  return body?.message ?? 'Что-то пошло не так'
}

export async function startGame(host: HTMLElement): Promise<void> {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.shadowMap.enabled = false
  host.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x1a1a1f)
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100)
  camera.rotation.order = 'YXZ'

  const hud = createHud(host)
  // Версия мира известна только после snapshot, поэтому менеджер создаётся на каждое подключение.
  const makeRooms = (version: string) =>
    new RoomManager({
      version,
      fetchRoomText,
      fetchAssetBlob,
      // flipY для ImageBitmap задаётся при декодировании: UNPACK_FLIP_Y_WEBGL на него не действует.
      decode: (blob) => createImageBitmap(blob, { imageOrientation: 'flipY' }),
    })
  let rooms: RoomManager | null = null

  let session: Session | null = null
  let cardFor: Exhibit | null = null
  let target: Exhibit | null = null

  const controls = new FirstPersonControls(renderer.domElement, (locked) => {
    const s = session
    hud.showClickOverlay(!locked && !!s?.ready, () => controls.lock())
    if (!locked) closeCard()
  })
  controls.enabled = false

  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight)
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
  }
  window.addEventListener('resize', resize)
  resize()

  function closeCard() {
    cardFor = null
    hud.showCard(null)
  }

  function teardown(s: Session | null) {
    if (!s) return
    s.ready = false
    s.ac.abort()
    if (s.moveTimer) clearInterval(s.moveTimer)
    s.socket?.close()
    if (s.built) {
      scene.remove(s.built.group)
      s.built.dispose()
    }
    rooms?.unload()
    if (session === s) session = null
    controls.enabled = false
    closeCard()
    hud.showHint(null)
    hud.showClickOverlay(false)
    target = null
  }

  function sendMove(s: Session) {
    if (!s.ready || !s.socket) return
    s.socket.send('player.move', {
      movement_epoch: s.epoch,
      seq: ++s.seq,
      position: { x: s.pos.x, y: 0, z: s.pos.z },
      rotation: { yaw: controls.yaw, pitch: controls.pitch },
    })
  }

  async function connect(): Promise<void> {
    teardown(session)
    const s: Session = {
      ac: new AbortController(),
      socket: null,
      manifest: null,
      built: null,
      exhibits: [],
      pos: { x: 0, z: 0 },
      epoch: 0,
      seq: 0,
      ready: false,
      moveTimer: null,
    }
    session = s
    hud.showLoading({ kind: 'loading', text: 'Загрузка зала…' })
    try {
      if (import.meta.env.VITE_USE_MOCK === 'true') await ensureDevSession()
      const { socket, snapshot } = await GameSocket.open()
      s.socket = socket
      socket.onClose(() => {
        if (session !== s || s.ac.signal.aborted) return
        teardown(s)
        hud.showLoading({ kind: 'error', message: 'Связь потеряна', onRetry: () => void connect() })
      })

      const manifest = await fetchManifest(s.ac.signal)
      if (manifest.world_version !== snapshot.world_version) throw new Error('Версия мира не совпадает, обновите страницу')
      s.manifest = manifest

      rooms = makeRooms(snapshot.world_version)
      const loaded = await rooms.load(snapshot.current_room, s.ac.signal)
      if (s.ac.signal.aborted) return
      s.built = buildRoom(loaded.room, loaded.bitmaps)
      s.exhibits = loaded.room.exhibits
      scene.add(s.built.group)

      const self = snapshot.self
      s.pos = { x: self.position.x, z: self.position.z }
      s.epoch = self.movement_epoch
      controls.yaw = self.rotation.yaw
      controls.pitch = self.rotation.pitch

      await socket.request('world.ready', { world_version: snapshot.world_version, movement_epoch: s.epoch }, 'world.ready')
      if (s.ac.signal.aborted) return

      s.ready = true
      s.moveTimer = setInterval(() => sendMove(s), MOVE_SEND_INTERVAL_MS)
      controls.enabled = true
      hud.showLoading(null)
      hud.showClickOverlay(!controls.locked, () => controls.lock())
    } catch (e) {
      if (s.ac.signal.aborted || session !== s) return
      teardown(s)
      hud.showLoading({ kind: 'error', message: `Не удалось загрузить зал: ${errorMessage(e)}`, onRetry: () => void connect() })
    }
  }

  controls.onInteract = async () => {
    if (cardFor) return closeCard()
    const s = session
    if (!s?.ready || !s.socket || !target || !controls.locked) return
    const exhibit = target
    sendMove(s) // серверная позиция должна быть свежей, иначе у границы 3 м придёт OUT_OF_RANGE
    cardFor = exhibit
    hud.showHint(null)
    hud.showCard({
      title: exhibit.title,
      description: exhibit.description,
      image: rooms?.current?.bitmaps.get(exhibit.image_asset_id) ?? null,
    })
    try {
      await s.socket.request('exhibit.inspect', { exhibit_id: exhibit.id }, 'exhibit.inspected')
    } catch (e) {
      if (cardFor === exhibit) closeCard()
      hud.showMessage(errorMessage(e))
    }
  }

  const dir = new THREE.Vector3()
  let last = performance.now()
  renderer.setAnimationLoop((now) => {
    const dt = Math.min((now - last) / 1000, MAX_FRAME_DT)
    last = now
    const s = session

    if (s?.ready && s.manifest && s.built) {
      const m = s.manifest.movement
      if (controls.locked && !cardFor) {
        const delta = moveVector(controls.keys.state, controls.yaw, m.max_speed_mps, dt)
        if (delta.x !== 0 || delta.z !== 0) {
          s.pos = moveCylinder(s.pos, delta, { colliders: s.built.colliders, bounds: s.built.bounds }, m.player_radius_m, m.player_height_m)
        }
      }
      camera.position.set(s.pos.x, m.camera_height_m, s.pos.z)
      camera.rotation.set(controls.pitch, controls.yaw, 0, 'YXZ')

      camera.getWorldDirection(dir)
      target = cardFor
        ? null
        : pickExhibit({ eye: camera.position, dir, playerXZ: s.pos }, s.exhibits)
      hud.showHint(!cardFor && target && controls.locked ? `E — осмотреть: ${target.title}` : null)
    }
    renderer.render(scene, camera)
  })

  await connect()
}
