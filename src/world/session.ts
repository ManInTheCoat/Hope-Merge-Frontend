import type * as THREE from 'three'
import type { Door, Exhibit, Guide, Manifest, Player } from '../network/contract'
import type { GameSocket } from '../network/ws'
import type { LastPhoto } from '../photo/lastPhoto'
import { PlayerRegistry } from '../players/registry'
import { RoomSync } from '../room/sync'
import type { MoveWorld, Vec2 } from '../scene/collision'
import type { BuiltRoom } from '../scene/roomBuilder'
import type { AssetBudget } from './AssetBudget'
import { MoveHistory } from './moveHistory'
import { MovePath } from './movePath'
import type { RoomManager } from './RoomManager'

/** Одно подключение к игре: от сокета до его закрытия. */
export type Session = {
  ac: AbortController
  socket: GameSocket | null
  manifest: Manifest | null
  budget: AssetBudget | null
  /** Отписка HUD от бюджета этой сессии. */
  budgetOff: (() => void) | null
  built: BuiltRoom | null
  /** Коллайдеры зала на высоте игрока и границы: считаются один раз при постройке. */
  moveWorld: MoveWorld | null
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
  /** Траектория с прошлой отправки: отправляем её точки, а не хорду через угол. */
  path: MovePath
  /** Прошлая отправка остановилась на промежуточной точке: следующую шлём, не дожидаясь таймера. */
  pathBehind: boolean
  players: PlayerRegistry
  roomId: string | null
  /** Runtime зала (Sunday v1): последний принятый снимок и лимит room.sync. */
  sync: RoomSync
  /** Последний снимок; создаётся вместе с бюджетом подключения. */
  photo: LastPhoto | null
  /** Идут съёмка или загрузка фото: движение и переходы заблокированы. */
  photoBusy: boolean
  /** Игра хоть раз была готова (world.ready): закрытие сокета дальше — обрыв, а не неудачный вход. */
  joined: boolean
  /** Связь потеряна: сцена ещё на экране, но сессия ждёт переподключения и её события не обрабатываются. */
  lost: boolean
}

export function newSession(): Session {
  return {
    ac: new AbortController(),
    socket: null,
    manifest: null,
    budget: null,
    budgetOff: null,
    built: null,
    moveWorld: null,
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
    path: new MovePath(),
    pathBehind: false,
    players: new PlayerRegistry(''),
    roomId: null,
    sync: new RoomSync(null, ''),
    photo: null,
    photoBusy: false,
    joined: false,
    lost: false,
  }
}

/** Позиция и epoch от сервера (snapshot, переход): движение начинается заново с seq 1. */
export function applySelf(s: Session, self: Player, view: { yaw: number; pitch: number }): void {
  s.roomId = self.room_id
  s.epoch = self.movement_epoch
  s.seq = 0
  s.lastMoveSentAt = null
  s.history = new MoveHistory()
  s.pos = { x: self.position.x, z: self.position.z }
  s.path.reset(s.pos)
  s.pathBehind = false
  view.yaw = self.rotation.yaw
  view.pitch = self.rotation.pitch
  s.players.setSelf(self)
}

/** Полностью освобождает зал: сцена, геометрия, текстуры, bitmap и резервы бюджета. Повторный вызов ничего не делает. */
export function unloadRoom(s: Session, scene: { remove(o: THREE.Object3D): unknown }, manager: RoomManager | null): void {
  if (s.built) {
    scene.remove(s.built.group)
    s.built.dispose()
    s.built = null
  }
  s.moveWorld = null
  manager?.unload()
  s.exhibits = []
  s.guides = []
  s.doors = []
}
