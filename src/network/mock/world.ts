import type {
  AssetContentType,
  Door,
  Exhibit,
  Manifest,
  Room,
  RoomPackage,
  Surface,
  Vec3,
} from '../contract'

const WORLD_ID = 'mock-world'
export const WORLD_VERSION = 'mock-1'
export const START_ROOM_ID = 'hall_antiquity'
export const START_POSITION: Vec3 = { x: 0, y: 0, z: 5 }

// Манифест описывает весь мир (в бою это 24 зала), моки отдают лишь два из них.
// Знаменатель бюджета берём как у настоящего мира, иначе 3 МиБ резерва фото не помещаются в 10%.
const MOCK_TOTAL_CONTENT_BYTES = 44_040_192

type StoredAsset = { id: string; bytes: number; contentType: AssetContentType; blob: Blob }
type StoredRoom = { room: Room; json: string; pkg: RoomPackage }

export type MockWorld = {
  manifest: Manifest
  rooms: Map<string, StoredRoom>
  assets: Map<string, StoredAsset>
  /** Позиция появления у дверей: ключ — `${room_id}`, куда входит игрок. */
  spawns: Map<string, Vec3>
}

const encoder = new TextEncoder()

const HALF_W = 6
const HALF_D = 8
const HEIGHT = 4

function box(id: string, x: number, y: number, z: number, w: number, h: number, d: number, color: string, collidable: boolean): Surface {
  return { id, position: { x, y, z }, size: { x: w, y: h, z: d }, color, collidable }
}

function buildSurfaces(prefix: string, wall: string, floor: string): Surface[] {
  const t = 0.2
  return [
    box(`${prefix}_floor`, 0, -0.05, 0, HALF_W * 2, 0.1, HALF_D * 2, floor, false),
    box(`${prefix}_ceiling`, 0, HEIGHT + 0.05, 0, HALF_W * 2, 0.1, HALF_D * 2, wall, false),
    box(`${prefix}_wall_n`, 0, HEIGHT / 2, -HALF_D - t / 2, HALF_W * 2 + t * 2, HEIGHT, t, wall, true),
    box(`${prefix}_wall_s`, 0, HEIGHT / 2, HALF_D + t / 2, HALF_W * 2 + t * 2, HEIGHT, t, wall, true),
    box(`${prefix}_wall_w`, -HALF_W - t / 2, HEIGHT / 2, 0, t, HEIGHT, HALF_D * 2, wall, true),
    box(`${prefix}_wall_e`, HALF_W + t / 2, HEIGHT / 2, 0, t, HEIGHT, HALF_D * 2, wall, true),
  ]
}

function exhibit(id: string, title: string, description: string, assetId: string, x: number): Exhibit {
  return {
    id,
    title,
    description,
    image_asset_id: assetId,
    position: { x, y: 1.8, z: -HALF_D + 0.05 },
    rotation_y: 0,
    width_m: 2,
    height_m: 1.5,
    interaction_radius_m: 3,
  }
}

function door(id: string, target: string, label: string): Door {
  return {
    id,
    target_room_id: target,
    label,
    position: { x: 0, y: 0, z: HALF_D - 0.3 },
    interaction_radius_m: 1.5,
  }
}

async function makeImage(label: string, hue: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(1024, 768)
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createLinearGradient(0, 0, 1024, 768)
  grad.addColorStop(0, `hsl(${hue} 55% 38%)`)
  grad.addColorStop(1, `hsl(${(hue + 50) % 360} 60% 62%)`)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 1024, 768)
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.font = 'bold 64px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(label, 512, 400)
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
}

/** `image` — генератор картинок экспонатов (в тестах без OffscreenCanvas — заглушка). */
export async function buildWorld(image: (label: string, hue: number) => Promise<Blob> = makeImage): Promise<MockWorld> {
  const assets = new Map<string, StoredAsset>()
  const addAsset = async (id: string, label: string, hue: number) => {
    const blob = await image(label, hue)
    assets.set(id, { id, bytes: blob.size, contentType: 'image/jpeg', blob })
  }
  await Promise.all([
    addAsset('asset_vase', 'Амфора', 20),
    addAsset('asset_bust', 'Бюст', 200),
    addAsset('asset_fresco', 'Фреска', 340),
    addAsset('asset_icon', 'Икона', 45),
    addAsset('asset_map', 'Карта', 140),
  ])

  // У каждого зала свой гид: личность (guide.id) задаёт историю и память диалога (api.md §3, §7).
  const guide = (id: string, display_name: string, subtitle: string, x: number, z: number) => ({
    id,
    display_name,
    subtitle,
    position: { x, y: 0, z },
    rotation_y: 0,
    interaction_radius_m: 3 as const,
  })

  const rooms: Room[] = [
    {
      id: START_ROOM_ID,
      world_version: WORLD_VERSION,
      title: 'Зал античности',
      bounds: { min: { x: -HALF_W, y: 0, z: -HALF_D }, max: { x: HALF_W, y: HEIGHT, z: HALF_D } },
      surfaces: buildSurfaces('antiquity', '#f2f0ec', '#9a9893'),
      doors: [door('door_antiquity_to_medieval', 'hall_medieval', 'В зал Средневековья')],
      exhibits: [
        exhibit('exhibit_vase', 'Краснофигурная амфора', 'Афины, V век до н. э. Сцена пира, роспись по обожжённой глине.', 'asset_vase', -3),
        exhibit('exhibit_bust', 'Бюст императора', 'Рим, I век н. э. Мрамор, копия греческого оригинала.', 'asset_bust', 0),
        exhibit('exhibit_fresco', 'Фреска из Помпей', 'I век н. э. Сад с птицами, найдена при раскопках виллы.', 'asset_fresco', 3),
      ],
      guides: [guide('guide_leonardo', 'Леонардо да Винчи', 'Художник и изобретатель', 3, -3)],
    },
    {
      id: 'hall_medieval',
      world_version: WORLD_VERSION,
      title: 'Зал Средневековья',
      bounds: { min: { x: -HALF_W, y: 0, z: -HALF_D }, max: { x: HALF_W, y: HEIGHT, z: HALF_D } },
      surfaces: buildSurfaces('medieval', '#f2f0ec', '#9a9893'),
      doors: [door('door_medieval_to_antiquity', START_ROOM_ID, 'Назад в зал античности')],
      exhibits: [
        exhibit('exhibit_icon', 'Икона XV века', 'Северная Русь. Темпера по дереву, золотой фон.', 'asset_icon', -2),
        exhibit('exhibit_map', 'Карта торговых путей', 'XIV век. Пергамент, маршруты между портами.', 'asset_map', 2),
      ],
      guides: [
        guide('guide_monet', 'Клод Моне', 'Отец импрессионизма', -3, -3),
        guide('guide_vangogh', 'Винсент Ван Гог', 'Мастер цвета и мазка', 3, -3),
      ],
    },
  ]

  const stored = new Map<string, StoredRoom>()
  for (const room of rooms) {
    const json = JSON.stringify(room)
    const descriptorBytes = encoder.encode(json).length
    const roomAssets = [...new Set(room.exhibits.map((e) => e.image_asset_id))].map((id) => {
      const a = assets.get(id)!
      return { id, bytes: a.bytes, content_type: a.contentType }
    })
    const pkg: RoomPackage = { room_id: room.id, descriptor_bytes: descriptorBytes, assets: roomAssets }
    stored.set(room.id, { room, json, pkg })
  }

  const manifest: Manifest = {
    world_id: WORLD_ID,
    world_version: WORLD_VERSION,
    total_content_bytes: MOCK_TOTAL_CONTENT_BYTES,
    client_cache_limit_bytes: Math.floor(MOCK_TOTAL_CONTENT_BYTES / 10),
    max_loaded_rooms: 1,
    photo_reserve_bytes: 3145728,
    movement: {
      send_rate_hz: 10,
      state_rate_hz: 10,
      max_speed_mps: 4,
      player_radius_m: 0.3,
      player_height_m: 1.8,
      camera_height_m: 1.65,
    },
  }

  const spawns = new Map<string, Vec3>([
    [START_ROOM_ID, { x: 0, y: 0, z: 5.5 }],
    ['hall_medieval', { x: 0, y: 0, z: 5.5 }],
  ])

  return { manifest, rooms: stored, assets, spawns }
}
