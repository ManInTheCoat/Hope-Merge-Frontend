import * as THREE from 'three'
import { ContentError, fetchAssetBlob, fetchGenerationByRequest, fetchGenerations, fetchManifest, fetchMe, fetchRoom, logout, uploadPhoto } from './network/api'
import { type Door, type ErrorBody, type Exhibit, type Guide } from './network/contract'
import { closeAction, ReconnectLoop, type ConnectResult, type LinkState } from './network/reconnect'
import { uuidV4 } from './network/uuid'
import { FpsMeter, startTelemetry } from './network/telemetry'
import { fetchAdminMe } from './network/adminApi'
import { GameSocket } from './network/ws'
import { canvasEncoder, copyFrame, encodeUnderLimit } from './photo/frame'
import { photoKeyAction } from './photo/keys'
import { downloadBlob, LastPhoto } from './photo/lastPhoto'
import { photoErrorText, savePhoto, type Shot } from './photo/save'
import { PlayerRegistry } from './players/registry'
import { RemotePlayersView } from './players/view'
import { CharacterLibrary } from './characters/library'
import { createGuideActor } from './characters/guideFigure'
import { createGalleryLook } from './scene/galleryLook'
import { QualityGovernor } from './scene/quality'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { activeColliders, moveCylinder } from './scene/collision'
import { FirstPersonControls, typingInField } from './scene/controls'
import { CLIENT_SPEED_FACTOR, moveSendBudget, moveVector, shouldSendMove } from './scene/input'
import { HandCamera } from './scene/handCamera'
import { buildRoom } from './scene/roomBuilder'
import { pickDoor, pickTarget, type Target } from './scene/targeting'
import { createChat } from './ui/chat'
import { createControlsBar } from './ui/controlsBar'
import { chatKeyAction, chatLineText } from './ui/chatLog'
import { askErrorText, GuideAsks } from './ui/guideAsks'
import { panelKeyAction } from './ui/guideKeys'
import { createAdminPanel } from './ui/adminPanel'
import { createGuidePanel } from './ui/guidePanel'
import { NO_CONNECTION, NO_RESPONSE, userErrorText } from './ui/errorText'
import { createHud } from './ui/hud'
import { hasSunday, mergeGuides, RoomSync } from './room/sync'
import { linkView } from './ui/linkView'
import { createLoginScreen } from './ui/login'
import { createPhotoCard } from './ui/photoCard'
import { AssetBudget } from './world/AssetBudget'
import { applySelf, newSession, unloadRoom, type Session } from './world/session'
import { RoomManager, type LoadedRoom } from './world/RoomManager'

const MOVE_SEND_INTERVAL_MS = 100
const MAX_FRAME_DT = 0.1
const MIN_MOVE_GAP_MS = 50
const CHAT_SEND_TIMEOUT_MS = 10_000
/** Без guide.accepted или error за это время проверяем вопрос по request_id. */
const ASK_ACCEPT_TIMEOUT_MS = 10_000
const GUIDE_CANCEL_TIMEOUT_MS = 10_000
/** Без world.entered за это время считаем подтверждение потерянным и переподключаемся (api.md, «Переход»). */
const ENTER_TIMEOUT_MS = 10_000
/** Аномальное закрытие (1006): так считаем потерю связи, обнаруженную самим клиентом. */
const ABNORMAL_CLOSE = 1006
/** Подпись на затемнении появляется, только если зал грузится дольше этого. */
const FADE_TEXT_DELAY_MS = 400


export async function startGame(host: HTMLElement): Promise<void> {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  // Чёткость подстраивается под машину: показ идёт на чужом, возможно слабом компьютере.
  const quality = new QualityGovernor({
    min: Math.min(0.6, window.devicePixelRatio),
    max: Math.min(window.devicePixelRatio, 1.5),
    step: 0.15,
    lowFps: 45,
    highFps: 58,
    windowS: 3,
  })
  renderer.setPixelRatio(quality.ratio)
  renderer.shadowMap.enabled = false
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.95
  host.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x1a1a1f)
  // Окружение для мягких отражений на бетоне и рамах: генерируется кодом один раз за сеанс страницы.
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.5
  pmrem.dispose()
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100)
  camera.rotation.order = 'YXZ'

  const hud = createHud(host)
  const hand = new HandCamera()
  /** Сглаженная доля скорости ходьбы для покачивания фотоаппарата. */
  let walkBlend = 0
  /** Средний FPS для `client.metrics`: считает все кадры rAF, отчёт уходит раз в 2 с. */
  const fpsMeter = new FpsMeter()
  // Версия мира и лимит кеша известны только после snapshot и манифеста, поэтому менеджер — на каждое подключение.
  const makeRooms = (version: string, budget: AssetBudget) =>
    new RoomManager({
      version,
      budget,
      fetchRoom,
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
  /** Модели персонажей грузятся параллельно со входом; до загрузки (или при ошибке) — капсулы. */
  let characters: CharacterLibrary | null = null
  /** Зал строится только после этой загрузки, иначе гиды первого зала остались бы капсулами. Не отклоняется. */
  const charactersReady = CharacterLibrary.load().then(
    (lib) => {
      characters = lib
      view.setLibrary(lib)
    },
    (err) => console.warn('Модели персонажей не загрузились', err),
  )

  const controls = new FirstPersonControls(renderer.domElement, (locked) => {
    const s = session
    hud.showClickOverlay(!locked && !!s?.ready && !chat.isOpen && !guidePanel.isOpen && !adminPanel.isOpen, () => controls.lock())
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

  const asks = new GuideAsks({
    // Пропуск в потоке: если генерация уже завершена, итог берём из истории (api.md §7).
    onGap: () => {
      const a = asks.active
      const s = session
      if (!a || !s) return
      fetchGenerationByRequest(a.guideId, a.requestId, s.ac.signal)
        .then((gen) => {
          if (session === s && gen && (gen.status === 'completed' || gen.status === 'failed')) asks.finished(gen)
        })
        .catch(() => {}) // итог всё равно придёт в guide.completed или в истории при следующем открытии
    },
  })
  const adminPanel = createAdminPanel(host, { onClose: () => resumeControls(false) })
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
      setTimeout(() => void recoverAsk(s, guide.id, requestId), ASK_ACCEPT_TIMEOUT_MS)
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
   * Нет guide.accepted за ASK_ACCEPT_TIMEOUT_MS: вопрос мог быть принят, а ответ потерян. Точное состояние —
   * по request_id (api.md §7); 404 — вопрос не принят, текст возвращается в поле.
   */
  async function recoverAsk(s: Session, guideId: string, requestId: string) {
    const a = asks.active
    if (session !== s || a?.requestId !== requestId || a.generationId !== null) return
    let gen
    try {
      gen = await fetchGenerationByRequest(guideId, requestId, s.ac.signal)
    } catch {
      if (session === s) askFailed(requestId, NO_RESPONSE)
      return
    }
    if (session !== s) return
    const back = asks.recover(requestId, gen)
    if (back) returnQuestion(back, NO_RESPONSE)
  }

  /**
   * Вопрос не принят. Текст возвращаем в поле, только если открыт тот же гид: иначе Enter отправил бы его
   * другому гиду. В остальных случаях — сообщение поверх игры.
   */
  function askFailed(requestId: string, text: string) {
    const r = asks.rejected(requestId)
    if (r) returnQuestion(r, text)
  }

  function returnQuestion(r: { question: string; guideId: string }, text: string) {
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

  /** Кнопка «Админ» видна только при GET /admin/me = 200; проверка повторяется после каждого входа в мир. */
  async function refreshAdminButton(s: Session) {
    const isAdmin = await fetchAdminMe()
    if (session !== s || s.lost || s.ac.signal.aborted) return
    hud.showAdmin(isAdmin ? openAdmin : null)
  }

  function openAdmin() {
    controls.enabled = false
    controls.keys.clear()
    hud.showClickOverlay(false)
    if (controls.locked) document.exitPointerLock()
    adminPanel.open()
  }

  function openGuide(s: Session, guide: Guide) {
    sendMove(s, true) // серверная позиция должна быть свежей, иначе у границы 3 м придёт OUT_OF_RANGE
    hud.showHint(null)
    s.built?.guides.find((a) => a.id === guide.id)?.greet()
    controls.enabled = false
    controls.keys.clear()
    hud.showClickOverlay(false)
    // Панель открываем до снятия захвата: обработчик pointerlockchange должен видеть её открытой.
    guidePanel.open(guide)
    if (controls.locked) document.exitPointerLock()
  }

  const loginScreen = createLoginScreen(host, () => {
    firstEntry = true
    returningEntry = false
    void loop.connectNow()
  })

  const controlsBar = createControlsBar(host)
  /** Снимок, который показывает карточка: «Повторить» отправляет его же с тем же ключом. */
  let lastShot: Shot | null = null
  const photoCard = createPhotoCard(host, {
    onRetry: () => {
      const s = session
      // Во время перехода, переподключения или другой загрузки повтор недоступен.
      if (s && lastShot && !actionsLocked(s)) void uploadShot(s, lastShot)
    },
    onDownload: () => downloadPhoto(),
  })

  /** Игровые действия (движение, E, F, повтор фото) заблокированы: нет готовности, связь потеряна или идёт фото. */
  function actionsLocked(s: Session | null): boolean {
    return !s || !s.ready || s.lost || s.photoBusy
  }

  function canShoot(s: Session | null): s is Session {
    return !actionsLocked(s) && !!s!.photo && controls.locked && !cardFor && !chat.isOpen && !guidePanel.isOpen && !adminPanel.isOpen
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
      blob = await encodeUnderLimit(canvasEncoder(frame), frame.width, frame.height) // copyFrame уже вписал кадр
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
    // Сервер проверяет расстояние до экспоната по своей позиции: она должна быть свежей, как перед осмотром.
    if (exhibitId) sendMove(s, true)
    await uploadShot(s, shot)
  }

  /** Загрузка снимка с блокировкой движения и переходов до ответа сервера. */
  async function uploadShot(s: Session, shot: Shot) {
    let current = shot
    try {
      const url = s.photo?.url
      if (!url) return
      if (!s.ready || s.lost || !s.socket?.isOpen) {
        photoCard.show(url, { kind: 'error', text: NO_CONNECTION })
        return
      }
      s.photoBusy = true
      controls.keys.clear()
      photoCard.show(url, { kind: 'uploading' })
      try {
        await savePhoto(shot, uploadPhoto, {
          signal: s.ac.signal,
          // Экспонат не принят: ручной повтор должен идти уже без него и с новым ключом.
          onFallback: (next) => {
            if (lastShot === current) lastShot = next
            current = next
          },
        })
        if (session === s && lastShot === current) photoCard.show(url, { kind: 'saved' })
      } catch (e) {
        if (session !== s || s.ac.signal.aborted) return // выход или обрыв: об этом уже сообщает экран
        if (lastShot === current) photoCard.show(url, { kind: 'error', text: photoErrorText(e) })
      }
    } finally {
      if (session === s) s.photoBusy = false
    }
  }

  function showLogin() {
    loop.stop()
    teardown(session)
    hud.showLoading(null)
    hud.showLogout(null)
    loginScreen.show()
  }

  async function onLogout() {
    loop.stop()
    teardown(session)
    onLinkState({ kind: 'login' }, false)
    hud.showLogout(null)
    hud.showLoading({ kind: 'loading', text: 'Выход…' })
    // Ждём ответа: иначе поздний logout отзовёт уже новую сессию после быстрого повторного входа.
    await logout().catch(() => {})
    showLogin()
  }

  /** Старт страницы: при живой сессии сразу в мир, иначе экран входа. */
  async function enterWorld(): Promise<void> {
    hud.showLoading({ kind: 'loading', text: 'Подключение…' })
    let me
    try {
      me = await fetchMe()
    } catch {
      hud.showLoading(null)
      return loop.handleClose(ABNORMAL_CLOSE) // сервер недоступен: повторы по расписанию
    }
    if (!me) return showLogin()
    returningEntry = true
    await loop.connectNow()
  }

  // --- Соединение: вход, обрыв, переподключение (api.md §4) ---

  /** Ещё ни разу не вошли в игру после входа в аккаунт: попытки — это вход, а не переподключение. */
  let firstEntry = true
  /** Вход по живой сессии (перезагрузка страницы): игрок возвращается на своё место. */
  let returningEntry = false
  let linkState: LinkState = { kind: 'login' }
  let linkTicker: ReturnType<typeof setInterval> | null = null
  const linkActions = {
    retryNow: () => loop.retryNow(),
    enterWorld: () => {
      firstEntry = true
      void loop.connectNow()
    },
    reload: () => location.reload(),
  }

  const loop = new ReconnectLoop({
    connect: (isCurrent) => connectOnce(isCurrent),
    async checkMe() {
      try {
        return (await fetchMe()) ? 'ok' : 'unauthenticated'
      } catch {
        return 'network'
      }
    },
    schedule: (fn, ms) => {
      const t = setTimeout(fn, ms)
      return () => clearTimeout(t)
    },
    now: () => Date.now(),
    onState: (state) => onLinkState(state),
  })

  function renderLink() {
    hud.showLink(linkView(linkState, Date.now(), firstEntry), linkActions)
  }

  function onLinkState(state: LinkState, react = true) {
    linkState = state
    if (linkTicker) clearInterval(linkTicker)
    linkTicker = state.kind === 'waiting' ? setInterval(renderLink, 250) : null
    if (react) {
      if (state.kind === 'online') firstEntry = false
      else if (state.kind === 'login') showLogin()
      else if (state.kind === 'replaced' || state.kind === 'update' || state.kind === 'stopped') {
        teardown(session)
        hud.showLoading(null)
        hud.showLogout(() => void onLogout())
      } else if (state.kind === 'waiting' && !session) hud.showLoading(null) // вход не удался: вместо экрана загрузки — баннер
    }
    renderLink()
  }

  /**
   * Связь с живой игрой потеряна (закрытие сервером, обрыв, потеря подтверждения перехода).
   * При временной ошибке зал остаётся на экране, управление и команды заблокированы до переподключения.
   */
  function lose(s: Session, code: number) {
    if (s.lost || session !== s) return
    s.lost = true
    if (closeAction(code) === 'retry') {
      blockForTransition(s)
      chat.close()
      asks.reset() // сервер отменяет генерацию при разрыве (api.md §7)
      lastShot = null
      photoCard.hide()
      controlsBar.setVisible(false)
      hud.showClickOverlay(false)
      if (controls.locked) document.exitPointerLock()
      // Обрыв посреди перехода: зал (если ещё загружен) остаётся виден под баннером, а не за затемнением.
      hud.fadeText(null)
      void hud.fade(false)
      s.socket?.close()
    } else teardown(s)
    loop.handleClose(code)
  }

  document.addEventListener('keydown', (e) => {
    if (e.repeat) return
    const shooter = canShoot(session) ? session : null
    const photoAction = photoKeyAction(e.code, {
      typing: typingInField(),
      canShoot: shooter !== null,
      hasPhoto: !!session?.photo?.blob,
    })
    if (photoAction) {
      e.preventDefault()
      if (photoAction === 'download') return downloadPhoto()
      if (shooter) void takePhoto(shooter)
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
      blocked: loginScreen.visible || !!cardFor || guidePanel.isOpen || adminPanel.isOpen || !session?.socket?.isOpen,
    })
    if (!action) return
    e.preventDefault()
    if (action === 'close') {
      chat.close()
      resumeControls(false)
      return
    }
    if (action === 'focus') return chat.focus()
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

  /**
   * `reconnecting` — смена соединения: строки общего чата остаются, затемнение не снимается
   * (прежний зал освобождается уже под ним).
   */
  function teardown(s: Session | null, reconnecting = false) {
    if (!s) return
    s.ready = false
    s.ac.abort()
    // Отписка до выгрузки зала: иначе release при unload снова покажет строку кеша.
    s.budgetOff?.()
    s.budgetOff = null
    hud.showCache(null)
    if (!reconnecting) {
      void hud.fade(false)
      hud.fadeText(null)
    }
    if (s.moveTimer) clearInterval(s.moveTimer)
    s.socket?.close()
    s.photo?.release()
    s.photoBusy = false
    lastShot = null
    photoCard.hide()
    controlsBar.setVisible(false)
    if (controls.locked) document.exitPointerLock() // иначе клик по кнопке «Повторить» уходит в захваченный canvas
    unloadRoom(s, scene, rooms)
    s.players.clear()
    view.clear()
    chat.close()
    if (!reconnecting) chat.clear()
    guidePanel.close()
    adminPanel.close()
    hud.showAdmin(null)
    asks.reset()
    if (session === s) session = null
    controls.enabled = false
    closeCard()
    hud.showHint(null)
    hud.showClickOverlay(false)
    target = null
    doorTarget = null
  }

  function showRoom(s: Session, loaded: LoadedRoom) {
    s.built = buildRoom(loaded.room, loaded.bitmaps, undefined, {
      guideFactory: characters ? createGuideActor(characters) : undefined,
      look: createGalleryLook(),
    })
    s.moveWorld = {
      colliders: activeColliders(s.built.colliders, s.manifest?.movement.player_height_m ?? 1.8),
      bounds: s.built.bounds,
    }
    s.exhibits = loaded.room.exhibits
    s.guides = loaded.room.guides
    s.doors = loaded.room.doors
    scene.add(s.built.group)
    applyRuntime(s)
  }

  /**
   * Применяет последний принятый runtime к построенному залу и к списку гидов для targeting. Без объявленного
   * `sunday_v1`, до постройки зала или для снимка другого зала ничего не делает: снимок подождёт showRoom().
   */
  function applyRuntime(s: Session) {
    const rt = s.sync.current
    if (!rt || !hasSunday(s.manifest) || !s.built || s.built.group.name !== rt.room_id) return
    s.built.runtime.apply(rt)
    s.guides = mergeGuides(s.guides, rt)
  }

  /** Перечитывает состояние зала (api-sunday.md §1): ответ придёт обычным world.runtime с этим request_id. */
  function requestRoomSync(s: Session) {
    if (!hasSunday(s.manifest) || !s.socket || s.lost) return
    if (s.sync.tryRequestSync(performance.now())) s.socket.send('room.sync', {})
  }

  function becomeReady(s: Session) {
    s.ready = true
    s.joined = true
    s.moveTimer = setInterval(() => sendMove(s), MOVE_SEND_INTERVAL_MS)
    const dialogOpen = chat.isOpen || guidePanel.isOpen || adminPanel.isOpen
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
    const alive = () => session === s && !s.ac.signal.aborted && !s.lost
    sendMove(s, true) // сервер меряет расстояние до двери по своей позиции: она должна быть свежей
    blockForTransition(s)
    const faded = hud.fade(true)

    let entered
    try {
      entered = await socket.request('world.enter', { door_id: door.id, movement_epoch: s.epoch }, 'world.entered', ENTER_TIMEOUT_MS)
    } catch (e) {
      if (!alive()) return
      if (e instanceof Error && e.message === 'SOCKET_CLOSED') return // обрыв обработает onClose
      // Подтверждение потеряно: фактический зал придёт в snapshot после переподключения (api.md §5).
      if (e instanceof Error && e.message === 'REQUEST_TIMEOUT') return lose(s, ABNORMAL_CLOSE)
      await hud.fade(false) // сервер отказал: состояние не менялось, возвращаем игрока
      if (!alive()) return
      becomeReady(s)
      hud.showMessage(userErrorText(e))
      return
    }
    await faded
    if (!alive()) return

    // Сначала полностью освобождаем старый зал, только потом новые загрузки (api.md, «Учёт бюджета»).
    unloadRoom(s, scene, manager)
    // Переход отменил незавершённый вопрос на сервере (api.md §7): точное состояние даст история.
    asks.reset()
    const { self, current_room } = entered
    applySelf(s, self, controls)
    // Снимок привязан к залу и epoch: повторить его загрузку из нового зала нельзя.
    lastShot = null
    photoCard.hide()

    const slow = setTimeout(() => hud.fadeText(`Переход: ${door.label}…`), FADE_TEXT_DELAY_MS)
    try {
      const loaded = await manager.load(current_room, s.ac.signal)
      await charactersReady
      if (!alive()) return
      showRoom(s, loaded)
      await socket.request('world.ready', { world_version: manifest.world_version, movement_epoch: s.epoch }, 'world.ready')
      if (!alive()) return
    } catch (e) {
      if (!alive()) return
      // Серверная позиция уже в новом зале: переподключение возьмёт её из snapshot.
      hud.showMessage(`Не удалось загрузить зал: ${userErrorText(e)}`)
      lose(s, ABNORMAL_CLOSE)
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
    const m = s.manifest?.movement
    if (!m || !s.moveWorld) return
    // Сервер разрешает 4·min(dt, 0,25) м; бюджет отправки чуть больше скорости ходьбы, чтобы отставание догонялось.
    const elapsed = s.lastMoveSentAt === null ? MOVE_SEND_INTERVAL_MS : now - s.lastMoveSentAt
    const maxStep = moveSendBudget(m.max_speed_mps, elapsed)
    const pos = s.path.take(s.moveWorld, m.player_radius_m, maxStep) ?? s.path.sent
    s.pathBehind = s.path.pending
    s.lastMoveSentAt = now
    const seq = ++s.seq
    s.history.record(seq, pos)
    s.socket.send('player.move', {
      movement_epoch: s.epoch,
      seq,
      position: { x: pos.x, y: 0, z: pos.z },
      rotation: { yaw: controls.yaw, pitch: controls.pitch },
    })
  }

  /**
   * Одна попытка входа в мир (api.md §4): сокет и snapshot, затем manifest, сверка версии, освобождение
   * прежнего мира, загрузка current_room и world.ready. Прежний зал остаётся на экране до нового snapshot.
   */
  async function connectOnce(isCurrent: () => boolean): Promise<ConnectResult> {
    const old = session
    if (!old) hud.showLoading({ kind: 'loading', text: returningEntry ? 'Возвращаемся на место…' : 'Загрузка зала…' })
    hud.showLogout(() => void onLogout())

    let opened
    try {
      opened = await GameSocket.open()
    } catch (e) {
      const m = e instanceof Error ? /^SOCKET_CLOSED:(\d+)$/.exec(e.message) : null
      return { ok: false, code: m ? Number(m[1]) : null, error: e }
    }
    const { socket, snapshot } = opened
    startTelemetry(socket, fpsMeter) // metrics и pong разрешены до ready; остановится вместе с сокетом
    // Runtime приходит сразу за snapshot, а сессия создаётся позже (после затемнения): копим снимок здесь.
    const sync = new RoomSync(snapshot.self.room_id, snapshot.world_version)
    let live: Session | null = null
    socket.on('world.entered', ({ self }) => sync.enter(self.room_id))
    socket.on('world.runtime', (rt) => {
      if (sync.accept(rt) && live && !live.lost) applyRuntime(live)
    })
    if (!isCurrent()) {
      socket.close()
      return { ok: false, code: null, error: new Error('CANCELLED') }
    }

    if (old) {
      // Сначала затемнение, потом освобождение прежнего мира: без вспышки пустой сцены.
      await hud.fade(true)
      teardown(old, true)
      hud.fadeText('Загрузка зала…')
    }
    const s = newSession()
    session = s
    s.socket = socket
    s.sync = sync
    live = s
    let closedCode: number | null = null
    try {
      s.selfId = snapshot.self.user_id
      s.players = new PlayerRegistry(s.selfId)
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
        if (corrected) {
          s.pos = corrected
          s.path.reset(corrected)
          s.pathBehind = false
        }
      })
      socket.on('error', (body, env) => {
        if (body.code === 'REVISION_CONFLICT') requestRoomSync(s) // чужая правка успела раньше: читаем актуальное
        // Ошибки без request_id относятся к player.move: сервер отклонил структуру шага.
        if (!env.request_id) return console.warn('Сервер отклонил player.move:', body.code, body.message)
        askFailed(env.request_id, askErrorText(body))
      })
      socket.onClose((code) => {
        closedCode = code
        if (session !== s || s.ac.signal.aborted || s.lost) return
        if (s.joined) lose(s, code) // до готовности неудачу вернёт сама попытка
      })

      const manifest = await fetchManifest(s.ac.signal)
      if (manifest.world_version !== snapshot.world_version) throw new Error('Версия мира не совпадает, обновите страницу')
      s.manifest = manifest
      s.budget = new AssetBudget(manifest.client_cache_limit_bytes)
      s.photo = new LastPhoto(s.budget)
      const total = manifest.total_content_bytes
      hud.showCache({ used: 0, total, limit: s.budget.limit })
      s.budgetOff = s.budget.onChange((used, limit) => hud.showCache({ used, total, limit }))

      rooms = makeRooms(snapshot.world_version, s.budget)
      const loaded = await rooms.load(snapshot.current_room, s.ac.signal)
      await charactersReady
      s.ac.signal.throwIfAborted()
      showRoom(s, loaded)
      if (!old && returningEntry) hud.showLoading({ kind: 'loading', text: `Возвращаемся в зал «${loaded.room.title}»…` })
      applySelf(s, snapshot.self, controls)

      await socket.request('world.ready', { world_version: snapshot.world_version, movement_epoch: s.epoch }, 'world.ready')
      if (!isCurrent() || session !== s) throw new Error('CANCELLED')
      // С этого момента закрытие сокета — обрыв живой игры: его обработает lose(), даже во время снятия затемнения.
      s.joined = true
    } catch (e) {
      if (session === s) teardown(s, true)
      else s.socket?.close()
      hud.fadeText(null)
      void hud.fade(false)
      return { ok: false, code: closedCode, error: e }
    }
    hud.fadeText(null)
    await hud.fade(false)
    hud.showLoading(null)
    // Связь могла оборваться, пока снималось затемнение: lose() уже запустил повторы, управление не включаем.
    if (s.lost || session !== s) return { ok: false, code: closedCode, error: new Error('SOCKET_CLOSED') }
    becomeReady(s)
    void refreshAdminButton(s)
    return { ok: true }
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
  const labelParentQ = new THREE.Quaternion()
  let last = performance.now()
  renderer.setAnimationLoop((now) => {
    fpsMeter.frame()
    const dt = Math.min((now - last) / 1000, MAX_FRAME_DT)
    // Длинный кадр — вкладка была скрыта или идёт загрузка зала: в замер FPS не берём.
    const rawDt = (now - last) / 1000
    const ratio = rawDt < 0.5 ? quality.sample(rawDt) : null
    if (ratio !== null) renderer.setPixelRatio(ratio)
    last = now
    const s = session

    if (s?.budget) hud.showMemory(renderer.info.memory.textures, renderer.info.memory.geometries)
    // Камера и игроки обновляются, как только зал построен: при выходе из затемнения после перехода
    // новый зал должен быть виден уже с точки появления, а не со старой позиции у двери.
    if (s?.manifest && s.built) {
      const m = s.manifest.movement
      let walked = 0
      if (!actionsLocked(s) && controls.locked && !cardFor) {
        const delta = moveVector(controls.keys.state, controls.yaw, m.max_speed_mps * CLIENT_SPEED_FACTOR, dt)
        if (delta.x !== 0 || delta.z !== 0) {
          const before = s.pos
          s.pos = moveCylinder(s.pos, delta, s.moveWorld!, m.player_radius_m)
          s.path.record(s.pos)
          if (dt > 0) walked = Math.hypot(s.pos.x - before.x, s.pos.z - before.z) / dt / m.max_speed_mps
        }
      }
      // Угол обойдён не целиком: досылаем точки траектории, не дожидаясь таймера (не чаще MIN_MOVE_GAP_MS).
      if (s.ready && s.pathBehind && shouldSendMove(s.lastMoveSentAt, now, MIN_MOVE_GAP_MS)) sendMove(s)
      walkBlend += (Math.min(walked, 1) - walkBlend) * Math.min(1, dt * 8)
      camera.position.set(s.pos.x, m.camera_height_m, s.pos.z)
      camera.rotation.set(controls.pitch, controls.yaw, 0, 'YXZ')

      if (s.ready) {
        camera.getWorldDirection(dir)
        target = cardFor
          ? null
          : pickTarget({ eye: camera.position, dir, colliders: s.built.colliders, rangeFrom: s.path.sent }, s.exhibits, s.guides)
        // Экспонат или гид в прицеле важнее двери рядом. Расстояние — от позиции, которую уже знает сервер:
        // подсказка появляется, только когда он примет действие.
        doorTarget = cardFor || target ? null : pickDoor(s.path.sent, s.doors, s.built.colliders)
        const hint =
          target?.kind === 'exhibit'
            ? `E — осмотреть: ${target.exhibit.title}`
            : target?.kind === 'guide'
              ? `E — поговорить: ${target.guide.display_name}`
              : doorTarget
                ? `E — перейти: ${doorTarget.label}`
                : null
        // Действие недоступно (фото, переход, переподключение, открытая панель) — подсказку не показываем.
        hud.showHint(!cardFor && controls.locked && !actionsLocked(s) && !guidePanel.isOpen && !adminPanel.isOpen ? hint : null)
      }
      if (s.roomId) view.update(s.players, s.roomId, now, camera)
      // Табличка — дочерний узел повёрнутой фигуры гида: мировой поворот к камере задаём через родителя.
      s.built.runtime.update(dt)
      for (const actor of s.built.guides) {
        actor.update(dt, s.path.sent)
        const label = actor.label
        label.parent!.getWorldQuaternion(labelParentQ)
        label.quaternion.copy(labelParentQ.invert().multiply(camera.quaternion))
      }
    }
    controlsBar.setVisible(!actionsLocked(s) && controls.locked && !chat.isOpen && !guidePanel.isOpen && !adminPanel.isOpen && !cardFor)
    renderer.render(scene, camera)
    hand.visible = !!s?.built
    hand.update(now, walkBlend)
    hand.render(renderer)
  })

  window.addEventListener('pagehide', () => {
    // Штатное закрытие: сервер сохраняет последнюю позицию (api.md §2). Политика повторов не запускается.
    const s = session
    if (!s) return
    s.lost = true
    if (s.moveTimer) clearInterval(s.moveTimer)
    s.ready = false
    s.socket?.close()
  })
  // Возврат из кеша страницы (кнопка «Назад»): сокет был закрыт при уходе — подключаемся сразу.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted && session?.lost) loop.retryNow()
  })

  await enterWorld()
}
