// Типы контракта API v1. Источник истины: api.md в корне репозитория.

export const API_BASE = '/api/v1'
export const WS_PATH = '/api/v1/ws'
export const PROTOCOL_VERSION = 1

export type Vec3 = { x: number; y: number; z: number }
export type Rotation = { yaw: number; pitch: number }
export type Pose = { room_id: string; position: Vec3; rotation: Rotation }

export type User = {
  id: string
  username: string
  display_name: string
  avatar_color: string
}

export type Player = {
  user_id: string
  display_name: string
  avatar_color: string
  room_id: string
  position: Vec3
  rotation: Rotation
  movement_epoch: number
  ack_seq: number
}

export type ErrorBody = {
  code: string
  message: string
  fields?: Record<string, string>
  retry_after_ms?: number
}

export type HttpErrorBody = { error: ErrorBody & { request_id: string } }

// --- Авторизация ---

export type RegisterRequest = { username: string; display_name: string; password: string }
export type LoginRequest = { username: string; password: string }
export type AuthResponse = { user: User }
export type MeResponse = { user: User; player_state: Pose }

// --- Мир ---

export type Manifest = {
  world_id: string
  world_version: string
  total_content_bytes: number
  client_cache_limit_bytes: number
  max_loaded_rooms: 1
  photo_reserve_bytes: 3145728
  movement: {
    send_rate_hz: 10
    state_rate_hz: 10
    max_speed_mps: 4
    player_radius_m: 0.3
    player_height_m: 1.8
    camera_height_m: 1.65
  }
}

export type AssetContentType = 'image/jpeg' | 'image/webp'

export type RoomPackage = {
  room_id: string
  descriptor_bytes: number
  assets: { id: string; bytes: number; content_type: AssetContentType }[]
}

export type Surface = {
  id: string
  position: Vec3
  size: Vec3
  color: string
  collidable: boolean
}

export type Door = {
  id: string
  target_room_id: string
  label: string
  position: Vec3
  interaction_radius_m: 1.5
}

export type Exhibit = {
  id: string
  title: string
  description: string
  image_asset_id: string
  position: Vec3
  rotation_y: number
  width_m: number
  height_m: number
  interaction_radius_m: 3
}

export type Guide = {
  id: string
  display_name: string
  subtitle: string
  position: Vec3
  rotation_y: number
  interaction_radius_m: 3
}

export type Room = {
  id: string
  world_version: string
  title: string
  bounds: { min: Vec3; max: Vec3 }
  surfaces: Surface[]
  doors: Door[]
  exhibits: Exhibit[]
  guides: Guide[]
}

// --- Гиды ---

export type DialogMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  created_at: string
}

export type GenerationStatus = 'queued' | 'running' | 'completed' | 'failed'

export type Generation = {
  id: string
  request_id: string
  guide_id: string
  exhibit_id: string | null
  status: GenerationStatus
  user_message: DialogMessage
  assistant_message: DialogMessage | null
  error: { code: string; message: string; retryable: boolean } | null
}

export type GenerationsPage = { items: Generation[]; next_before: string | null }

// --- Фото ---

export type Photo = {
  id: string
  owner_id: string
  caption: string
  room_id: string
  exhibit_id: string | null
  published: boolean
  image_url: string
  image_bytes: number
  thumbnail_url: string
  thumbnail_bytes: number
  width: number
  height: number
  created_at: string
}

export type PhotosPage = { items: Photo[]; next_cursor: string | null }

// --- WebSocket: клиент → сервер ---

export type ClientEvents = {
  'world.ready': { world_version: string; movement_epoch: number }
  'world.enter': { door_id: string; movement_epoch: number }
  'player.move': {
    movement_epoch: number
    seq: number
    position: Vec3
    rotation: Rotation
  }
  'chat.send': { text?: string; photo_id?: string }
  'exhibit.inspect': { exhibit_id: string }
  'guide.ask': { guide_id: string; text: string; exhibit_id?: string }
  'guide.cancel': { generation_id: string }
}

export type ClientEventType = keyof ClientEvents

/** `request_id` обязателен у всех команд, кроме `player.move`. */
export type ClientEnvelope<T extends ClientEventType = ClientEventType> = {
  [K in T]: { type: K; request_id?: string; payload: ClientEvents[K] }
}[T]

// --- WebSocket: сервер → клиент ---

export type ServerEvents = {
  'world.snapshot': {
    protocol_version: 1
    world_version: string
    self: Player
    players: Player[]
    current_room: RoomPackage
  }
  'world.ready': { movement_epoch: number }
  'world.entered': { self: Player; current_room: RoomPackage }
  'player.joined': { player: Player }
  'player.left': { user_id: string }
  'players.state': { players: Player[] }
  'chat.message': {
    message_id: string
    author: { user_id: string; display_name: string }
    text: string
    photo: Photo | null
  }
  'exhibit.inspected': { exhibit_id: string; inspected_at: string }
  'guide.accepted': { generation: Generation }
  'guide.started': { generation_id: string }
  'guide.delta': { generation_id: string; index: number; text: string }
  'guide.completed': { generation: Generation }
  'guide.failed': { generation: Generation }
  'guide.cancelled': { generation: Generation }
  error: ErrorBody
}

export type ServerEventType = keyof ServerEvents

export type ServerEnvelope<T extends ServerEventType = ServerEventType> = {
  [K in T]: {
    type: K
    event_id: string
    server_time: string
    request_id?: string
    payload: ServerEvents[K]
  }
}[T]

// --- Коды закрытия WS ---

export const CloseCode = {
  Normal: 1000,
  UnsupportedData: 1003,
  PolicyViolation: 1008,
  MessageTooBig: 1009,
  InternalError: 1011,
  ServiceRestart: 1012,
  TryAgainLater: 1013,
  SessionExpired: 4001,
  UnsupportedProtocol: 4006,
  Replaced: 4009,
} as const
