import * as THREE from 'three'
import { ContentError, fetchAssetBlob, fetchGenerations, fetchManifest, fetchMe, fetchRoomText, logout, uploadPhoto } from './network/api'
import { CloseCode, type Door, type ErrorBody, type Exhibit, type Guide, type Manifest } from './network/contract'
import { uuidV4 } from './network/uuid'
import { GameSocket } from './network/ws'
import { canvasEncoder, copyFrame, encodeUnderLimit, fitFrame } from './photo/frame'
import { photoKeyAction } from './photo/keys'
import { downloadBlob, LastPhoto } from './photo/lastPhoto'
import { photoErrorText, savePhoto, type Shot } from './photo/save'
import { PlayerRegistry } from './players/registry'
import { RemotePlayersView } from './players/view'
import { moveCylinder, type Vec2 } from './scene/collision'
import { FirstPersonControls, typingInField } from './scene/controls'
import { CLIENT_SPEED_FACTOR, moveVector, shouldSendMove } from './scene/input'
import { HandCamera } from './scene/handCamera'
import { buildRoom, type BuiltRoom } from './scene/roomBuilder'
import { pickDoor, pickTarget, type Target } from './scene/targeting'
import { createChat } from './ui/chat'
import { createControlsBar } from './ui/controlsBar'
import { chatKeyAction, chatLineText } from './ui/chatLog'
import { askErrorText, GuideAsks } from './ui/guideAsks'
import { panelKeyAction } from './ui/guideKeys'
import { createGuidePanel } from './ui/guidePanel'
import { userErrorText } from './ui/errorText'
import { createHud } from './ui/hud'
import { createLoginScreen } from './ui/login'
import { createPhotoCard } from './ui/photoCard'
import { AssetBudget } from './world/AssetBudget'
import { MoveHistory } from './world/moveHistory'
import { RoomManager, type LoadedRoom } from './world/RoomManager'

const MOVE_SEND_INTERVAL_MS = 100
const MAX_FRAME_DT = 0.1
const MIN_MOVE_GAP_MS = 50
const CHAT_SEND_TIMEOUT_MS = 10_000
/** Без guide.accepted или error за это время снимаем вопрос и возвращаем текст в поле. */
const ASK_ACCEPT_TIMEOUT_MS = 10_000
const GUIDE_CANCEL_TIMEOUT_MS = 10_000
/** Без world.entered за это время считаем подтверждение потерянным и переподключаемся (api.md, «Переход»). */
const ENTER_TIMEOUT_MS = 10_000
/** Подпись на затемнении появляется, только если зал грузится дольше этого. */
const FADE_TEXT_DELAY_MS = 400

type Session = {
  ac: AbortController
  socket: GameSocket | null
  manifest: Manifest | null
  budget: AssetBudget | null
  /** Отписка HUD от бюджета этой сессии. */
  budgetOff: (() => void) | null
  built: BuiltRoom | null
  exhibits: Exhibit[]
  guides: Guide[]
  doors: Door[]
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
  /** Последний снимок; создаётся вместе с бюджетом подключения. */
  photo: LastPhoto | null
  /** Идут съёмка или загрузка фото: движение и переходы заблокированы. */
  photoBusy: boolean
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
  const hand = new HandCamera()
  /** Сглаженная доля скорости ходьбы для покачивания фотоаппарата. */
  let walkBlend = 0
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
  let target: Target = null
  let doorTarget: Door | null = null

  const view = new RemotePlayersView(scene)

  const controls = new FirstPersonControls(renderer.domElement, (locked) => {
    const s = session
    hud.showClickOverlay(!locked && !!s?.ready && !chat.isOpen && !guidePanel.isOpen, () => controls.lock())
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
        throw new Error(userErrorText(e))
      }
    },
    onClose: (sent) => resumeControls(sent),
  })

  const asks = new GuideAsks()
  const guidePanel = createGuidePanel(host, {
    asks,
    loadPage: (guideId, before) => fetchGenerations(guideId, before, session?.ac.signal),
    onAsk(guide, text) {
      const s = session
      if (!s?.ready || !s.socket?.isOpen) return 'Нет связи с сервером'
      sendMove(s, true) // сервер меряет расстояние до гида по своей позиции
      const requestId = s.socket.send('guide.ask', { guide_id: guide.id, text })
      if (!requestId) return 'Нет связи с сервером'
      asks.start({ requestId, guideId: guide.id, guideName: guide.display_name, question: text })
      setTimeout(() => {
        if (session === s) askFailed(requestId, 'Сервер не ответил, попробуйте ещё раз')
      }, ASK_ACCEPT_TIMEOUT_MS)
      return null
    },
    async onCancel() {
      const socket = session?.socket
      const generationId = asks.active?.generationId
      if (!generationId) return
      if (!socket?.isOpen) throw new Error('Нет связи с сервером')
      try {
        await socket.request('guide.cancel', { generation_id: generationId }, 'guide.cancelled', GUIDE_CANCEL_TIMEOUT_MS)
      } catch (e) {
        throw new Error(e instanceof Error ? userErrorText(e) : askErrorText(e as Partial<ErrorBody>))
      }
    },
    onClose: () => resumeControls(true),
  })

  /**
   * Вопрос не принят. Текст возвращаем в поле, только если открыт тот же гид: иначе Enter отправил бы его
   * другому гиду. В остальных случаях — сообщение поверх игры.
   */
  function askFailed(requestId: string, text: string) {
    const r = asks.rejected(requestId)
    if (!r) return
    if (guidePanel.guideId === r.guideId) guidePanel.showError(text, r.question)
    else hud.showMessage(`Вопрос гиду не отправлен: ${text}`)
  }

  /** Общий чат или диалог закрыт: управление снова доступно; `lock` — сразу захватить мышь. */
  function resumeControls(lock: boolean) {
    const ready = !!session?.ready
    controls.enabled = ready
    // Оверлей нужен на случай, если захват не удастся; при успехе pointerlockchange его скроет.
    hud.showClickOverlay(ready && !controls.locked, () => controls.lock())
    if (lock && ready) controls.lock()
  }

  function openGuide(s: Session, guide: Guide) {
    sendMove(s, true) // серверная позиция должна быть свежей, иначе у границы 3 м придёт OUT_OF_RANGE
    hud.showHint(null)
    controls.enabled = false
    controls.keys.clear()
    hud.showClickOverlay(false)
    // Панель открываем до снятия захвата: обработчик pointerlockchange должен видеть её открытой.
    guidePanel.open(guide)
    if (controls.locked) document.exitPointerLock()
  }

  const loginScreen = createLoginScreen(host, () => void connect())

  const controlsBar = createControlsBar(host)
  /** Снимок, который показывает карточка: «Повторить» отправляет его же с тем же ключом. */
  let lastShot: Shot | null = null
  const photoCard = createPhotoCard(host, {
    onRetry: () => {
      const s = session
      if (s && lastShot && !s.photoBusy) void uploadShot(s, lastShot)
    },
    onDownload: () => downloadPhoto(),
  })

  function canShoot(s: Session | null): s is Session {
    return !!s?.ready && !!s.photo && controls.locked && !cardFor && !chat.isOpen && !guidePanel.isOpen && !s.photoBusy
  }

  function downloadPhoto() {
    const photo = session?.photo
    if (photo?.url && photo.fileName) downloadBlob(photo.url, photo.fileName)
  }

  async function takePhoto(s: Session) {
    const photo = s.photo!
    const roomId = s.roomId!
    s.photoBusy = true
    controls.keys.clear()
    // Прежний оригинал освобождается до новой съёмки: карточка с его ссылкой больше не нужна.
    lastShot = null
    photoCard.hide()
    try {
      photo.begin()
    } catch (e) {
      s.photoBusy = false
      hud.showMessage(e instanceof ContentError ? 'Нет места в кеше для фото' : userErrorText(e))
      return
    }
    const takenAt = new Date()
    // Кадр копируем сразу после отрисовки, в том же синхронном участке: буфер WebGL ещё не очищен.
    renderer.render(scene, camera)
    const frame = copyFrame(renderer.domElement)
    hud.flash()
    hand.shoot(performance.now())
    const exhibitId = target?.kind === 'exhibit' ? target.exhibit.id : null
    let blob: Blob
    try {
      const size = fitFrame(frame.width, frame.height)
      blob = await encodeUnderLimit(canvasEncoder(frame), size.width, size.height)
    } catch (e) {
      photo.release()
      if (session === s) s.photoBusy = false
      hud.showMessage(`Не удалось снять кадр: ${userErrorText(e)}`)
      return
    }
    if (session !== s) return // сессия разобрана, бюджет и оригинал уже освобождены
    photo.commit(blob, roomId, takenAt)
    const shot: Shot = { key: uuidV4(), blob, roomId, epoch: s.epoch, exhibitId, takenAt }
    lastShot = shot
    await uploadShot(s, shot)
  }

  /** Загрузка снимка с блокировкой движения и переходов до ответа сервера. */
  async function uploadShot(s: Session, shot: Shot) {
    const url = s.photo?.url
    if (!url) return
    if (!s.ready || !s.socket?.isOpen) {
      photoCard.show(url, { kind: 'error', text: 'Нет связи с сервером' })
      return
    }
    s.photoBusy = true
    controls.keys.clear()
    photoCard.show(url, { kind: 'uploading' })
    try {
      await savePhoto(shot, uploadPhoto, { signal: s.ac.signal })
      if (session === s && lastShot === shot) photoCard.show(url, { kind: 'saved' })
    } catch (e) {
      if (session !== s || s.ac.signal.aborted) return // выход или обрыв: об этом уже сообщает экран
      if (lastShot === shot) photoCard.show(url, { kind: 'error', text: photoErrorText(e) })
    } finally {
      if (session === s) s.photoBusy = false
    }
  }

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
    if (me) await connect(true)
    else showLogin()
  }

  document.addEventListener('keydown', (e) => {
    if (e.repeat) return
    const photoAction = photoKeyAction(e.code, {
      typing: typingInField(),
      canShoot: canShoot(session),
      hasPhoto: !!session?.photo?.blob,
    })
    if (photoAction) {
      e.preventDefault()
      if (photoAction === 'download') return downloadPhoto()
      if (canShoot(session)) void takePhoto(session)
      return
    }
    // Фокус вне панели (клик мимо поля): E всё равно закрывает диалог.
    // Нажатие E, открывшее панель, погашено в controls (defaultPrevented) и её не закрывает.
    if (guidePanel.isOpen) {
      const panelAction = panelKeyAction(e.code, {
        typing: typingInField(),
        inputDisabled: asks.active !== null,
        opening: e.defaultPrevented,
      })
      if (panelAction) {
        e.preventDefault()
        guidePanel.close()
        resumeControls(true)
        return
      }
    }
    const action = chatKeyAction(e.code, {
      chatOpen: chat.isOpen,
      typing: typingInField(),
      blocked: loginScreen.visible || !!cardFor || guidePanel.isOpen || !session?.socket?.isOpen,
    })
    if (!action) return
    e.preventDefault()
    if (action === 'close') {
      chat.close()
      resumeControls(false)
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
    hand.setAspect(camera.aspect)
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
    // Отписка до выгрузки зала: иначе release при unload снова покажет строку кеша.
    s.budgetOff?.()
    s.budgetOff = null
    hud.showCache(null)
    void hud.fade(false)
    hud.fadeText(null)
    if (s.moveTimer) clearInterval(s.moveTimer)
    s.socket?.close()
    s.photo?.release()
    s.photoBusy = false
    lastShot = null
    photoCard.hide()
    controlsBar.setVisible(false)
    if (controls.locked) document.exitPointerLock() // иначе клик по кнопке «Повторить» уходит в захваченный canvas
    if (s.built) {
      scene.remove(s.built.group)
      s.built.dispose()
    }
    s.players.clear()
    view.clear()
    chat.close()
    chat.clear()
    guidePanel.close()
    asks.reset()
    rooms?.unload()
    if (session === s) session = null
    controls.enabled = false
    closeCard()
    hud.showHint(null)
    hud.showClickOverlay(false)
    target = null
    doorTarget = null
  }

  function showRoom(s: Session, loaded: LoadedRoom) {
    s.built = buildRoom(loaded.room, loaded.bitmaps)
    s.exhibits = loaded.room.exhibits
    s.guides = loaded.room.guides
    s.doors = loaded.room.doors
    scene.add(s.built.group)
  }

  function becomeReady(s: Session) {
    s.ready = true
    s.moveTimer = setInterval(() => sendMove(s), MOVE_SEND_INTERVAL_MS)
    const dialogOpen = chat.isOpen || guidePanel.isOpen
    controls.enabled = !dialogOpen
    if (!dialogOpen) hud.showClickOverlay(!controls.locked, () => controls.lock())
  }

  /** Движение, осмотр и переходы недоступны до нового world.ready. */
  function blockForTransition(s: Session) {
    s.ready = false
    if (s.moveTimer) clearInterval(s.moveTimer)
    s.moveTimer = null
    controls.enabled = false
    controls.keys.clear()
    closeCard()
    guidePanel.close()
    hud.showHint(null)
    target = null
    doorTarget = null
  }

  async function enterDoor(s: Session, door: Door): Promise<void> {
    const socket = s.socket
    const manager = rooms
    const manifest = s.manifest
    if (!socket || !manager || !manifest) return
    const alive = () => session === s && !s.ac.signal.aborted
    sendMove(s, true) // сервер меряет расстояние до двери по своей позиции: она должна быть свежей
    blockForTransition(s)
    const faded = hud.fade(true)

    let entered
    try {
      entered = await socket.request('world.enter', { door_id: door.id, movement_epoch: s.epoch }, 'world.entered', ENTER_TIMEOUT_MS)
    } catch (e) {
      if (!alive()) return
      if (e instanceof Error && e.message === 'SOCKET_CLOSED') return // экран ошибки покажет onClose
      if (e instanceof Error && e.message === 'REQUEST_TIMEOUT') return void connect() // фактический зал придёт в snapshot
      await hud.fade(false) // сервер отказал: состояние не менялось, возвращаем игрока
      if (!alive()) return
      becomeReady(s)
      hud.showMessage(userErrorText(e))
      return
    }
    await faded
    if (!alive()) return

    // Сначала полностью освобождаем старый зал, только потом новые загрузки (api.md, «Учёт бюджета»).
    if (s.built) {
      scene.remove(s.built.group)
      s.built.dispose()
      s.built = null
    }
    manager.unload()
    s.exhibits = []
    s.guides = []
    s.doors = []
    // Переход отменил незавершённый вопрос на сервере (api.md §7): точное состояние даст история.
    asks.reset()

    const { self, current_room } = entered
    s.roomId = current_room.room_id
    s.epoch = self.movement_epoch
    s.seq = 0
    s.lastMoveSentAt = null
    s.history = new MoveHistory()
    s.pos = { x: self.position.x, z: self.position.z }
    controls.yaw = self.rotation.yaw
    controls.pitch = self.rotation.pitch
    s.players.setSelf(self)

    const slow = setTimeout(() => hud.fadeText(`Переход: ${door.label}…`), FADE_TEXT_DELAY_MS)
    try {
      const loaded = await manager.load(current_room, s.ac.signal)
      if (!alive()) return
      showRoom(s, loaded)
      await socket.request('world.ready', { world_version: manifest.world_version, movement_epoch: s.epoch }, 'world.ready')
      if (!alive()) return
    } catch (e) {
      if (!alive()) return
      // Серверная позиция уже в новом зале: повтор через переподключение возьмёт её из snapshot.
      teardown(s)
      hud.showLoading({ kind: 'error', message: `Не удалось загрузить зал: ${userErrorText(e)}`, onRetry: () => void connect() })
      return
    } finally {
      clearTimeout(slow)
    }
    hud.fadeText(null)
    await hud.fade(false)
    if (!alive()) return
    becomeReady(s)
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

  /** `returning` — вход по живой сессии (перезагрузка страницы): игрок возвращается на своё место. */
  async function connect(returning = false): Promise<void> {
    teardown(session)
    const s: Session = {
      ac: new AbortController(),
      socket: null,
      manifest: null,
      budget: null,
      budgetOff: null,
      built: null,
      exhibits: [],
      guides: [],
      doors: [],
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
      photo: null,
      photoBusy: false,
    }
    session = s
    hud.showLoading({ kind: 'loading', text: returning ? 'Возвращаемся на место…' : 'Загрузка зала…' })
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
      socket.on('guide.accepted', ({ generation }, env) => asks.accepted(env.request_id ?? '', generation))
      socket.on('guide.started', ({ generation_id }) => asks.started(generation_id))
      socket.on('guide.delta', ({ generation_id, index, text }) => asks.delta(generation_id, index, text))
      socket.on('guide.completed', ({ generation }) => asks.finished(generation))
      socket.on('guide.failed', ({ generation }) => asks.finished(generation))
      socket.on('players.state', ({ players }) => {
        s.players.applyState(players, performance.now())
        const self = players.find((p) => p.user_id === s.selfId)
        if (!s.ready || !self || self.movement_epoch !== s.epoch) return
        const corrected = s.history.reconcile(self.ack_seq, self.position)
        if (corrected) s.pos = corrected
      })
      socket.on('error', (body, env) => {
        // Ошибки без request_id относятся к player.move: сервер отклонил структуру шага.
        if (!env.request_id) return console.warn('Сервер отклонил player.move:', body.code, body.message)
        askFailed(env.request_id, askErrorText(body))
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
      s.photo = new LastPhoto(s.budget)
      hud.showCache({ used: 0, limit: s.budget.limit })
      s.budgetOff = s.budget.onChange((used, limit) => hud.showCache({ used, limit }))

      rooms = makeRooms(snapshot.world_version, s.budget)
      const loaded = await rooms.load(snapshot.current_room, s.ac.signal)
      if (s.ac.signal.aborted) return
      showRoom(s, loaded)
      if (returning) hud.showLoading({ kind: 'loading', text: `Возвращаемся в зал «${loaded.room.title}»…` })

      const self = snapshot.self
      s.pos = { x: self.position.x, z: self.position.z }
      s.epoch = self.movement_epoch
      controls.yaw = self.rotation.yaw
      controls.pitch = self.rotation.pitch

      await socket.request('world.ready', { world_version: snapshot.world_version, movement_epoch: s.epoch }, 'world.ready')
      if (s.ac.signal.aborted) return

      hud.showLoading(null)
      becomeReady(s)
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
      hud.showLoading({ kind: 'error', message: `Не удалось загрузить зал: ${userErrorText(e)}`, onRetry: () => void connect() })
    }
  }

  renderer.domElement.addEventListener('click', () => {
    if (cardFor) closeCard()
  })

  controls.onInteract = async () => {
    if (session?.photoBusy) return // до ответа на фото ни осмотра, ни переходов
    if (cardFor) return closeCard()
    const s = session
    if (!s?.ready || !s.socket || !controls.locked) return
    if (!target) {
      if (doorTarget) void enterDoor(s, doorTarget)
      return
    }
    if (target.kind === 'guide') return openGuide(s, target.guide)
    const exhibit = target.exhibit
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
      hud.showMessage(userErrorText(e))
    }
  }

  const dir = new THREE.Vector3()
  let last = performance.now()
  renderer.setAnimationLoop((now) => {
    const dt = Math.min((now - last) / 1000, MAX_FRAME_DT)
    last = now
    const s = session

    if (s?.budget) hud.showMemory(renderer.info.memory.textures, renderer.info.memory.geometries)
    // Камера и игроки обновляются, как только зал построен: при выходе из затемнения после перехода
    // новый зал должен быть виден уже с точки появления, а не со старой позиции у двери.
    if (s?.manifest && s.built) {
      const m = s.manifest.movement
      let walked = 0
      if (s.ready && controls.locked && !cardFor && !s.photoBusy) {
        const delta = moveVector(controls.keys.state, controls.yaw, m.max_speed_mps * CLIENT_SPEED_FACTOR, dt)
        if (delta.x !== 0 || delta.z !== 0) {
          const before = s.pos
          s.pos = moveCylinder(s.pos, delta, { colliders: s.built.colliders, bounds: s.built.bounds }, m.player_radius_m, m.player_height_m)
          if (dt > 0) walked = Math.hypot(s.pos.x - before.x, s.pos.z - before.z) / dt / m.max_speed_mps
        }
      }
      walkBlend += (Math.min(walked, 1) - walkBlend) * Math.min(1, dt * 8)
      camera.position.set(s.pos.x, m.camera_height_m, s.pos.z)
      camera.rotation.set(controls.pitch, controls.yaw, 0, 'YXZ')

      if (s.ready) {
        camera.getWorldDirection(dir)
        target = cardFor
          ? null
          : pickTarget({ eye: camera.position, dir, playerXZ: s.pos, colliders: s.built.colliders }, s.exhibits, s.guides)
        // Экспонат или гид в прицеле важнее двери рядом.
        doorTarget = cardFor || target ? null : pickDoor(s.pos, s.doors)
        const hint =
          target?.kind === 'exhibit'
            ? `E — осмотреть: ${target.exhibit.title}`
            : target?.kind === 'guide'
              ? `E — поговорить: ${target.guide.display_name}`
              : doorTarget
                ? `E — перейти: ${doorTarget.label}`
                : null
        hud.showHint(!cardFor && controls.locked ? hint : null)
      }
      if (s.roomId) view.update(s.players, s.roomId, now, camera)
    }
    controlsBar.setVisible(!!s?.ready && controls.locked && !chat.isOpen && !guidePanel.isOpen)
    renderer.render(scene, camera)
    hand.visible = !!s?.built
    hand.update(now, walkBlend)
    hand.render(renderer)
  })

  // Штатное закрытие: сервер сохраняет последнюю позицию (api.md §2).
  window.addEventListener('pagehide', () => session?.socket?.close())

  await enterWorld()
}
