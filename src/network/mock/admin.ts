import type { Room } from '../contract'
import type {
  SundayAdminGuide,
  SundayGuideSettings,
  SundayGuides,
  SundayMaterialChoice,
  SundayRoomConfig,
  SundayRoomRuntime,
  SundayRooms,
} from '../sunday'
import { codePoints, trimWs } from '../../ui/text'
import { mockValidPose } from './geometry'
import { WORLD_VERSION, type MockWorld } from './world'
import { NPC_MAX } from '../../npc/limits'

export type AdminFail = { ok: false; status: number; code: string; message: string; fields?: Record<string, string> }
export type AdminResult<T> = { ok: true; value: T } | AdminFail

export type AdminState = {
  rooms(): SundayRooms
  room(id: string): SundayRoomRuntime | null
  /** Меняет конфигурацию зала; удерживаемая лампа блокирует правку (OBJECT_BUSY). */
  putRoom(id: string, body: unknown): AdminResult<SundayRoomRuntime>
  guides(): SundayGuides
  guide(id: string): SundayAdminGuide | null
  /** `touchedRooms` — залы, у которых изменилось публичное имя или подзаголовок гида (их runtime надо разослать). */
  putGuide(id: string, body: unknown): AdminResult<{ guide: SundayAdminGuide; touchedRooms: string[] }>
}

const fail = (status: number, code: string, message: string, fields?: Record<string, string>): AdminFail => ({
  ok: false,
  status,
  code,
  message,
  ...(fields ? { fields } : {}),
})
const invalid = (fields: Record<string, string>) => fail(400, 'VALIDATION_ERROR', 'Некорректные данные', fields)

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const sameKeys = (o: Record<string, unknown>, keys: string[]) =>
  Object.keys(o).length === keys.length && keys.every((k) => k in o)

const ROOM_CONFIG_KEYS = ['accent_color', 'lighting', 'guide_placements', 'lamp_slots', 'npc_count', 'installation_visible']
const SETTINGS_KEYS = ['display_name', 'subtitle', 'personality', 'style', 'topic', 'constraints', 'material_ids']
const TEXT_LIMITS: Record<'display_name' | 'subtitle' | 'personality' | 'style' | 'topic', number> = {
  display_name: 64,
  subtitle: 200,
  personality: 2000,
  style: 1000,
  topic: 1000,
}
const CONSTRAINTS_MAX = 20
const CONSTRAINT_MAX = 1000
const SETTINGS_SUM_MAX = 4000
const MATERIALS_MAX = 100

/** Материалы файлового профиля: три учебных, привязаны к реальным экспонатам мира. */
function buildMaterials(world: MockWorld): SundayMaterialChoice[] {
  const exhibits = [...world.rooms.values()].flatMap((r) => r.room.exhibits.map((e) => e.id))
  const pick = (i: number) => (exhibits[i] ? [exhibits[i]] : [])
  return [
    { id: 'mat_01', excerpt: 'Краткая история коллекции и принципы её атрибуции.', exhibit_ids: pick(0) },
    { id: 'mat_02', excerpt: 'Материалы и техники: роспись, мрамор, фреска.', exhibit_ids: pick(1) },
    { id: 'mat_03', excerpt: 'Контекст находок и места раскопок.', exhibit_ids: pick(2) },
  ]
}

type StoredGuide = { revision: number; settings: SundayGuideSettings }

export function createAdminState(world: MockWorld, runtimes: Map<string, SundayRoomRuntime>): AdminState {
  const materials = buildMaterials(world)
  const materialIds = new Set(materials.map((m) => m.id))
  const roomOf = (id: string): Room | undefined => world.rooms.get(id)?.room

  const guides = new Map<string, StoredGuide>()
  for (const { room } of world.rooms.values()) {
    for (const g of room.guides) {
      if (guides.has(g.id)) continue
      guides.set(g.id, {
        revision: 1,
        settings: {
          display_name: g.display_name,
          subtitle: g.subtitle,
          personality: 'Дружелюбный искусствовед, говорит просто и по делу.',
          style: 'Короткие абзацы, без жаргона.',
          topic: 'Экспонаты зала и их история.',
          constraints: ['Отвечать по-русски'],
          material_ids: materials.map((m) => m.id),
        },
      })
    }
  }

  function validateConfig(room: Room, config: unknown): Record<string, string> {
    const errors: Record<string, string> = {}
    if (!isObject(config) || !sameKeys(config, ROOM_CONFIG_KEYS)) return { config: 'Неверный набор полей' }
    if (typeof config.accent_color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(config.accent_color)) {
      errors.accent_color = 'Цвет в формате #RRGGBB'
    }
    if (config.lighting !== 'neutral' && config.lighting !== 'warm' && config.lighting !== 'cool') {
      errors.lighting = 'neutral, warm или cool'
    }
    if (!Number.isInteger(config.npc_count) || (config.npc_count as number) < 0 || (config.npc_count as number) > NPC_MAX) {
      errors.npc_count = `Целое число от 0 до ${NPC_MAX}`
    }
    if (typeof config.installation_visible !== 'boolean') errors.installation_visible = 'Нужно true или false'

    const slots = config.lamp_slots
    const slotsOk =
      Array.isArray(slots) &&
      slots.length === 2 &&
      slots.every(
        (s, i) =>
          isObject(s) &&
          s.slot_id === (i === 0 ? 'a' : 'b') &&
          isObject(s.position) &&
          Number.isFinite(s.position.x) &&
          Number.isFinite(s.position.z) &&
          s.position.y === 0,
      )
    if (!slotsOk) errors.lamp_slots = 'Два места: a и b, y=0'

    const placements = config.guide_placements
    const ids = room.guides.map((g) => g.id)
    const placementsOk =
      Array.isArray(placements) &&
      placements.length === ids.length &&
      ids.every((id) => placements.filter((p) => isObject(p) && p.guide_id === id).length === 1) &&
      placements.every((p) => {
        if (!isObject(p) || !isObject(p.position)) return false
        const { x, y, z } = p.position as Record<string, unknown>
        return (
          typeof x === 'number' &&
          typeof z === 'number' &&
          y === 0 &&
          Number.isFinite(p.rotation_y) &&
          mockValidPose(room, { x, y: 0, z })
        )
      })
    if (!placementsOk) errors.guide_placements = 'По одному месту на каждого гида, внутри зала и вне стен'
    return errors
  }

  function validateSettings(s: unknown): { errors: Record<string, string>; value?: SundayGuideSettings } {
    if (!isObject(s) || !sameKeys(s, SETTINGS_KEYS)) return { errors: { settings: 'Неверный набор полей' } }
    const errors: Record<string, string> = {}
    const out = {} as Record<string, unknown>
    for (const [key, max] of Object.entries(TEXT_LIMITS)) {
      const raw = s[key]
      const text = typeof raw === 'string' ? trimWs(raw) : ''
      const len = codePoints(text)
      if (typeof raw !== 'string' || len < 1 || len > max || text.includes('\u0000')) errors[key] = `От 1 до ${max} символов`
      out[key] = text
    }
    const constraints = Array.isArray(s.constraints) ? s.constraints.map((c) => (typeof c === 'string' ? trimWs(c) : null)) : null
    if (
      !constraints ||
      constraints.length < 1 ||
      constraints.length > CONSTRAINTS_MAX ||
      constraints.some((c) => c === null || codePoints(c) < 1 || codePoints(c) > CONSTRAINT_MAX || c.includes('\u0000'))
    ) {
      errors.constraints = `От 1 до ${CONSTRAINTS_MAX} строк, каждая до ${CONSTRAINT_MAX} символов`
    }
    out.constraints = constraints ?? []
    const ids = s.material_ids
    if (
      !Array.isArray(ids) ||
      ids.length > MATERIALS_MAX ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => typeof id !== 'string' || !materialIds.has(id))
    ) {
      errors.material_ids = 'Уникальные материалы из доступных'
    }
    out.material_ids = Array.isArray(ids) ? ids : []
    if (Object.keys(errors).length === 0) {
      const sum = ['personality', 'style', 'topic'].reduce((n, k) => n + codePoints(out[k] as string), 0)
      const total = sum + (out.constraints as string[]).reduce((n, c) => n + codePoints(c), 0)
      if (total > SETTINGS_SUM_MAX) errors.personality = `Сумма личности, стиля, темы и ограничений — до ${SETTINGS_SUM_MAX} символов`
    }
    return Object.keys(errors).length ? { errors } : { errors, value: out as SundayGuideSettings }
  }

  const guideView = (id: string): SundayAdminGuide => {
    const g = guides.get(id)!
    return {
      world_version: WORLD_VERSION,
      guide_id: id,
      revision: g.revision,
      settings: structuredClone(g.settings),
      available_materials: structuredClone(materials),
    }
  }

  return {
    rooms: () => ({
      rooms: [...world.rooms.values()].map(({ room }) => ({
        room_id: room.id,
        title: room.title,
        revision: runtimes.get(room.id)!.revision,
      })),
    }),
    room: (id) => runtimes.get(id) ?? null,

    putRoom(id, body) {
      const rt = runtimes.get(id)
      const room = roomOf(id)
      if (!rt || !room) return fail(404, 'NOT_FOUND', 'Нет такого зала')
      if (!isObject(body) || !sameKeys(body, ['world_version', 'expected_revision', 'config'])) {
        return invalid({ body: 'Нужны world_version, expected_revision, config' })
      }
      if (body.world_version !== WORLD_VERSION) return fail(409, 'WORLD_VERSION_MISMATCH', 'Версия мира не совпадает')
      if (!Number.isSafeInteger(body.expected_revision) || (body.expected_revision as number) < 1) {
        return invalid({ expected_revision: 'Положительное целое' })
      }
      const errors = validateConfig(room, body.config)
      if (Object.keys(errors).length) return invalid(errors)
      if (body.expected_revision !== rt.revision) return fail(409, 'REVISION_CONFLICT', 'Зал уже изменён, перечитайте его')
      if (rt.lamp.holder_user_id !== null) return fail(409, 'OBJECT_BUSY', 'Лампу держит посетитель')

      const config = structuredClone(body.config) as SundayRoomConfig
      // Лампа остаётся на прежнем месте, её углы не трогаем; места берём из принятого конфига.
      rt.config = config
      rt.guides = rt.guides.map((g) => {
        const p = config.guide_placements.find((x) => x.guide_id === g.guide_id)!
        return { ...g, position: { ...p.position }, rotation_y: p.rotation_y }
      })
      rt.revision += 1
      return { ok: true, value: rt }
    },

    guides: () => ({
      guides: [...guides].map(([guide_id, g]) => ({ guide_id, display_name: g.settings.display_name, revision: g.revision })),
    }),
    guide: (id) => (guides.has(id) ? guideView(id) : null),

    putGuide(id, body) {
      const stored = guides.get(id)
      if (!stored) return fail(404, 'NOT_FOUND', 'Нет такого гида')
      if (!isObject(body) || !sameKeys(body, ['world_version', 'expected_revision', 'settings'])) {
        return invalid({ body: 'Нужны world_version, expected_revision, settings' })
      }
      if (body.world_version !== WORLD_VERSION) return fail(409, 'WORLD_VERSION_MISMATCH', 'Версия мира не совпадает')
      if (!Number.isSafeInteger(body.expected_revision) || (body.expected_revision as number) < 1) {
        return invalid({ expected_revision: 'Положительное целое' })
      }
      const checked = validateSettings(body.settings)
      if (!checked.value) return invalid(checked.errors)
      if (body.expected_revision !== stored.revision) return fail(409, 'REVISION_CONFLICT', 'Гид уже изменён, перечитайте его')

      const publicChanged =
        checked.value.display_name !== stored.settings.display_name || checked.value.subtitle !== stored.settings.subtitle
      stored.settings = checked.value
      stored.revision += 1
      const touchedRooms: string[] = []
      if (publicChanged) {
        for (const [roomId, rt] of runtimes) {
          const g = rt.guides.find((x) => x.guide_id === id)
          if (!g) continue
          g.display_name = checked.value.display_name
          g.subtitle = checked.value.subtitle
          rt.revision += 1
          touchedRooms.push(roomId)
        }
      }
      return { ok: true, value: { guide: guideView(id), touchedRooms } }
    },
  }
}
