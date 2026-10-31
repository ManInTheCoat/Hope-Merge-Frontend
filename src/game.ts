import * as THREE from 'three'
import { fetchAssetBlob, fetchManifest, fetchMe, fetchRoomText, logout } from './network/api'
import { CloseCode, type ErrorBody, type Exhibit, type Manifest } from './network/contract'
import { GameSocket } from './network/ws'
import { PlayerRegistry } from './players/registry'
import { RemotePlayersView } from './players/view'
import { moveCylinder, type Vec2 } from './scene/collision'
import { FirstPersonControls, typingInField } from './scene/controls'
import { CLIENT_SPEED_FACTOR, moveVector, shouldSendMove } from './scene/input'
import { buildRoom, type BuiltRoom } from './scene/roomBuilder'
import { pickExhibit } from './scene/targeting'
import { createChat } from './ui/chat'
import { chatKeyAction, chatLineText } from './ui/chatLog'
import { createHud } from './ui/hud'
import { createLoginScreen } from './ui/login'
import { AssetBudget } from './world/AssetBudget'
import { MoveHistory } from './world/moveHistory'
import { RoomManager } from './world/RoomManager'

const MOVE_SEND_INTERVAL_MS = 100
const MAX_FRAME_DT = 0.1
const MIN_MOVE_GAP_MS = 50
const CHAT_SEND_TIMEOUT_MS = 10_000

type Session = {
  ac: AbortController
  socket: GameSocket | null
  manifest: Manifest | null
  budget: AssetBudget | null
  built: BuiltRoom | null
  exhibits: Exhibit[]
  pos: Vec2
  epoch: number
  seq: number
  ready: boolean
  moveTimer: ReturnType<typeof setInterval> | null
  lastMoveSentAt: number | null
  selfId: string
  history: MoveHistory
  players: PlayerRegistry
  roomId: string | null
}

function chatErrorText(e: unknown): string {
  if (e instanceof Error && e.message === 'REQUEST_TIMEOUT') return 'Сервер не ответил, попробуйте ещё раз'
  const body = e as Partial<ErrorBody> | null
  if (body?.code === 'RATE_LIMITED') return `Слишком часто, подождите ${Math.ceil((body.retry_after_ms ?? 1000) / 1000)} с`
  return errorMessage(e)
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
  // Версия мира и лимит кеша известны только после snapshot и манифеста, поэтому менеджер — на каждое подключение.
  const makeRooms = (version: string, budget: AssetBudget) =>
    new RoomManager({
      version,
      budget,
      fetchRoomText,
      fetchAssetBlob,
      // flipY для ImageBitmap задаётся при декодировании: UNPACK_FLIP_Y_WEBGL на него не действует.
      decode: (blob) => createImageBitmap(blob, { imageOrientation: 'flipY' }),
    })
  let rooms: RoomManager | null = null

  let session: Session | null = null
  let cardFor: Exhibit | null = null
  let cardToken = 0
  let target: Exhibit | null = null

  const view = new RemotePlayersView(scene)

  const controls = new FirstPersonControls(renderer.domElement, (locked) => {
    const s = session
    hud.showClickOverlay(!locked && !!s?.ready && !chat.isOpen, () => controls.lock())
    if (!locked) closeCard()
  })
  controls.enabled = false

  const chat = createChat(host, {
    async onSend(text) {
      const socket = session?.socket
      if (!socket?.isOpen) throw new Error('Нет связи с сервером')
      try {
        await socket.request('chat.send', { text }, 'chat.message', CHAT_SEND_TIMEOUT_MS)
      } catch (e) {
        throw new Error(chatErrorText(e))
      }
    },
    onClose: (sent) => afterChatClosed(sent),
  })

  function afterChatClosed(sent: boolean) {
    const ready = !!session?.ready
    controls.enabled = ready
    // Оверлей нужен на случай, если захват не удастся; при успехе pointerlockchange его скроет.
    hud.showClickOverlay(ready && !controls.locked, () => controls.lock())
    if (sent && ready) controls.lock()
  }

  const loginScreen = createLoginScreen(host, () => void connect())

  function showLogin() {
    teardown(session)
    hud.showLoading(null)
    hud.showLogout(null)
    loginScreen.show()
  }

  async function onLogout() {
    teardown(session)
    hud.showLogout(null)
    hud.showLoading({ kind: 'loading', text: 'Выход…' })
    // Ждём ответа: иначе поздний logout отзовёт уже новую сессию после быстрого повторного входа.
    await logout().catch(() => {})
    showLogin()
  }

  /** Старт и повтор: при живой сессии сразу в мир, иначе экран входа. */
  async function enterWorld(): Promise<void> {
    hud.showLoading({ kind: 'loading', text: 'Подключение…' })
    let me
    try {
      me = await fetchMe()
    } catch {
      return hud.showLoading({ kind: 'error', message: 'Сервер недоступен', onRetry: () => void enterWorld() })
    }
    if (me) await connect()
    else showLogin()
  }

  document.addEventListener('keydown', (e) => {
    if (e.repeat) return
    const action = chatKeyAction(e.code, {
      chatOpen: chat.isOpen,
      typing: typingInField(),
      blocked: loginScreen.visible || !!cardFor || !session?.socket?.isOpen,
    })
    if (!action) return
    e.preventDefault()
    if (action === 'close') {
      chat.close()
      afterChatClosed(false)
      return
    }
    chat.open()
    controls.enabled = false
    controls.keys.clear()
    hud.showClickOverlay(false)
    if (controls.locked) document.exitPointerLock()
  })

  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight)
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
  }
  window.addEventListener('resize', resize)
  resize()

  function closeCard() {
    cardFor = null
    cardToken++
    hud.showCard(null)
  }

  function teardown(s: Session | null) {
    if (!s) return
    s.ready = false
    s.ac.abort()
    if (s.moveTimer) clearInterval(s.moveTimer)
    s.socket?.close()
    if (controls.locked) document.exitPointerLock() // иначе клик по кнопке «Повторить» уходит в захваченный canvas
    if (s.built) {
      scene.remove(s.built.group)
      s.built.dispose()
    }
    s.players.clear()
    view.clear()
    chat.close()
    chat.clear()
    rooms?.unload()
    if (session === s) session = null
    controls.enabled = false
    closeCard()
    hud.showHint(null)
    hud.showClickOverlay(false)
    target = null
  }

  function sendMove(s: Session, force = false) {
    if (!s.ready || !s.socket) return
    const now = performance.now()
    if (force && !shouldSendMove(s.lastMoveSentAt, now, MIN_MOVE_GAP_MS)) return
    s.lastMoveSentAt = now
    const seq = ++s.seq
    s.history.record(seq, s.pos)
    s.socket.send('player.move', {
      movement_epoch: s.epoch,
      seq,
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
      budget: null,
      built: null,
      exhibits: [],
      pos: { x: 0, z: 0 },
      epoch: 0,
      seq: 0,
      ready: false,
      moveTimer: null,
      lastMoveSentAt: null,
      selfId: '',
      history: new MoveHistory(),
      players: new PlayerRegistry(''),
      roomId: null,
    }
    session = s
    hud.showLoading({ kind: 'loading', text: 'Загрузка зала…' })
    hud.showLogout(() => void onLogout())
    try {
      const { socket, snapshot } = await GameSocket.open()
      if (session !== s || s.ac.signal.aborted) {
        socket.close()
        return
      }
      s.socket = socket
      s.selfId = snapshot.self.user_id
      s.roomId = snapshot.current_room.room_id
      s.players = new PlayerRegistry(s.selfId)
      s.players.setSelf(snapshot.self)
      const t0 = performance.now()
      snapshot.players.forEach((p) => s.players.upsert(p, t0))
      socket.on('player.joined', ({ player }) => s.players.upsert(player, performance.now()))
      socket.on('player.left', ({ user_id }) => s.players.remove(user_id))
      socket.on('chat.message', ({ author, text, photo }) =>
        chat.add({
          author: author.display_name,
          color: s.players.colorOf(author.user_id),
          text: chatLineText(text, photo !== null),
        }),
      )
      socket.on('players.state', ({ players }) => {
        s.players.applyState(players, performance.now())
        const self = players.find((p) => p.user_id === s.selfId)
        if (!s.ready || !self || self.movement_epoch !== s.epoch) return
        const corrected = s.history.reconcile(self.ack_seq, self.position)
        if (corrected) s.pos = corrected
      })
      socket.on('error', (body, env) => {
        // Ошибки без request_id относятся к player.move: сервер отклонил структуру шага.
        if (!env.request_id) console.warn('Сервер отклонил player.move:', body.code, body.message)
      })
      socket.onClose((code) => {
        if (session !== s || s.ac.signal.aborted) return
        if (code === CloseCode.SessionExpired) return showLogin()
        teardown(s)
        hud.showLoading({ kind: 'error', message: 'Связь потеряна', onRetry: () => void connect() })
      })

      const manifest = await fetchManifest(s.ac.signal)
      if (manifest.world_version !== snapshot.world_version) throw new Error('Версия мира не совпадает, обновите страницу')
      s.manifest = manifest
      s.budget = new AssetBudget(manifest.client_cache_limit_bytes)

      rooms = makeRooms(snapshot.world_version, s.budget)
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
      controls.enabled = !chat.isOpen
      hud.showLoading(null)
      if (!chat.isOpen) hud.showClickOverlay(!controls.locked, () => controls.lock())
    } catch (e) {
      if (s.ac.signal.aborted || session !== s) return
      teardown(s)
      // Отказ upgrade браузер видит как закрытие до snapshot: проверяем сессию (api.md §4).
      if (e instanceof Error && e.message.startsWith('SOCKET_CLOSED')) {
        const me = await fetchMe().catch(() => undefined)
        // За время проверки пользователь мог выйти или зайти заново: тогда экран уже не наш.
        if (session !== null || loginScreen.visible) return
        if (me === null) return showLogin()
      }
      hud.showLoading({ kind: 'error', message: `Не удалось загрузить зал: ${errorMessage(e)}`, onRetry: () => void connect() })
    }
  }

  renderer.domElement.addEventListener('click', () => {
    if (cardFor) closeCard()
  })

  controls.onInteract = async () => {
    if (cardFor) return closeCard()
    const s = session
    if (!s?.ready || !s.socket || !target || !controls.locked) return
    const exhibit = target
    sendMove(s, true) // серверная позиция должна быть свежей, иначе у границы 3 м придёт OUT_OF_RANGE
    cardFor = exhibit
    const token = ++cardToken
    hud.showHint(null)
    hud.showCard({
      title: exhibit.title,
      description: exhibit.description,
      image: rooms?.current?.bitmaps.get(exhibit.image_asset_id) ?? null,
    })
    try {
      await s.socket.request('exhibit.inspect', { exhibit_id: exhibit.id }, 'exhibit.inspected')
    } catch (e) {
      if (session !== s) return // связь потеряна: об этом уже сообщает экран ошибки
      if (cardToken === token) closeCard()
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
        const delta = moveVector(controls.keys.state, controls.yaw, m.max_speed_mps * CLIENT_SPEED_FACTOR, dt)
        if (delta.x !== 0 || delta.z !== 0) {
          s.pos = moveCylinder(s.pos, delta, { colliders: s.built.colliders, bounds: s.built.bounds }, m.player_radius_m, m.player_height_m)
        }
      }
      camera.position.set(s.pos.x, m.camera_height_m, s.pos.z)
      camera.rotation.set(controls.pitch, controls.yaw, 0, 'YXZ')

      camera.getWorldDirection(dir)
      target = cardFor
        ? null
        : pickExhibit({ eye: camera.position, dir, playerXZ: s.pos, colliders: s.built.colliders }, s.exhibits)
      hud.showHint(!cardFor && target && controls.locked ? `E — осмотреть: ${target.title}` : null)
      if (s.roomId) view.update(s.players, s.roomId, now, camera)
    }
    renderer.render(scene, camera)
  })

  await enterWorld()
}
