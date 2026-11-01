import { expect, test } from 'bun:test'
import { clientRow } from '../src/admin/clientsTable'
import { draftToConfig, roomToDraft, validateRoomDraft } from '../src/admin/roomForm'
import { draftToSettings, guideToDraft, validateGuideDraft, type GuideDraft } from '../src/admin/guideForm'
import { saveOrReload } from '../src/admin/saveFlow'
import { ApiError } from '../src/network/api'
import { NO_CONNECTION } from '../src/ui/errorText'
import type { SundayAdminGuide, SundayClientMetric, SundayRoomRuntime } from '../src/network/sunday'

const guide: SundayAdminGuide = {
  world_version: 'mock-1',
  guide_id: 'guide_x',
  revision: 3,
  settings: {
    display_name: 'Леонардо',
    subtitle: 'Художник',
    personality: 'Любопытный',
    style: 'Простой',
    topic: 'Искусство',
    constraints: ['Отвечать по-русски', 'Не выдумывать'],
    material_ids: ['mat_01'],
  },
  available_materials: [
    { id: 'mat_01', excerpt: 'Первый', exhibit_ids: [] },
    { id: 'mat_02', excerpt: 'Второй', exhibit_ids: [] },
  ],
}
const available = guide.available_materials.map((m) => m.id)
const draft = (patch: Partial<GuideDraft> = {}): GuideDraft => ({ ...guideToDraft(guide), ...patch })

// --- форма гида ---

test('guideToDraft и draftToSettings: круговой переход', () => {
  expect(draftToSettings(guideToDraft(guide))).toEqual(guide.settings)
})

test('draftToSettings: пустые строки и пробелы по краям отбрасываются', () => {
  const s = draftToSettings(draft({ constraints: ' a \n\n b \n   ', display_name: '  Имя  ' }))
  expect(s.constraints).toEqual(['a', 'b'])
  expect(s.display_name).toBe('Имя')
})

test('validateGuideDraft: валидный черновик — без ошибок', () => {
  expect(validateGuideDraft(draft(), available)).toEqual({})
})

test('validateGuideDraft: имя 1–64 кодовых точки (эмодзи — одна)', () => {
  expect(validateGuideDraft(draft({ display_name: '   ' }), available).display_name).toBeDefined()
  expect(validateGuideDraft(draft({ display_name: '😀'.repeat(64) }), available).display_name).toBeUndefined()
  expect(validateGuideDraft(draft({ display_name: '😀'.repeat(65) }), available).display_name).toBeDefined()
})

test('validateGuideDraft: ограничения — от 1 до 20 строк, каждая до 1000', () => {
  expect(validateGuideDraft(draft({ constraints: ' \n ' }), available).constraints).toBeDefined()
  const many = Array.from({ length: 21 }, (_, i) => `r${i}`).join('\n')
  expect(validateGuideDraft(draft({ constraints: many }), available).constraints).toBeDefined()
  expect(validateGuideDraft(draft({ constraints: 'я'.repeat(1001) }), available).constraints).toBeDefined()
  expect(validateGuideDraft(draft({ constraints: 'я'.repeat(1000) }), available).constraints).toBeUndefined()
})

test('validateGuideDraft: сумма личности, стиля, темы и ограничений — до 4000', () => {
  const over = draft({ personality: 'а'.repeat(2000), style: 'б'.repeat(1000), topic: 'в'.repeat(1000), constraints: 'г' })
  expect(validateGuideDraft(over, available).personality).toBeDefined()
  const edge = draft({ personality: 'а'.repeat(2000), style: 'б'.repeat(1000), topic: 'в'.repeat(999), constraints: 'г' })
  expect(validateGuideDraft(edge, available)).toEqual({})
})

test('validateGuideDraft: символ NUL и неизвестный материал — ошибки', () => {
  expect(validateGuideDraft(draft({ topic: 'а\u0000б' }), available).topic).toBeDefined()
  expect(validateGuideDraft(draft({ material_ids: ['mat_99'] }), available).material_ids).toBeDefined()
})

// --- сохранение и конфликт ---

test('saveOrReload: успех возвращает saved и не перечитывает', async () => {
  let reloads = 0
  const r = await saveOrReload(async () => 'новое', async () => (reloads++, 'свежее'))
  expect(r).toEqual({ kind: 'saved', value: 'новое' })
  expect(reloads).toBe(0)
})

test('saveOrReload: REVISION_CONFLICT и OBJECT_BUSY перечитывают ровно один раз', async () => {
  for (const code of ['REVISION_CONFLICT', 'OBJECT_BUSY'] as const) {
    let reloads = 0
    const r = await saveOrReload(
      async () => {
        throw new ApiError(409, code, 'конфликт')
      },
      async () => (reloads++, 'свежее'),
    )
    expect(r).toEqual({ kind: 'conflict', code, value: 'свежее' })
    expect(reloads).toBe(1)
  }
})

test('saveOrReload: ошибка валидации отдаёт поля и не перечитывает', async () => {
  let reloads = 0
  const r = await saveOrReload(
    async () => {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Некорректные данные', { fields: { subtitle: 'длинно' } })
    },
    async () => (reloads++, 'свежее'),
  )
  expect(r).toEqual({ kind: 'error', text: 'Некорректные данные', fields: { subtitle: 'длинно' } })
  expect(reloads).toBe(0)
})

test('saveOrReload: обрыв сети — понятный текст; сбой перечитывания при конфликте — error', async () => {
  const net = await saveOrReload(
    async () => {
      throw new TypeError('Failed to fetch')
    },
    async () => 'x',
  )
  expect(net).toEqual({ kind: 'error', text: NO_CONNECTION })
  const broken = await saveOrReload(
    async () => {
      throw new ApiError(409, 'REVISION_CONFLICT', 'конфликт')
    },
    async () => {
      throw new TypeError('Failed to fetch')
    },
  )
  expect(broken).toEqual({ kind: 'error', text: NO_CONNECTION })
})

// --- форма зала ---

const runtime: SundayRoomRuntime = {
  world_version: 'mock-1',
  room_id: 'hall_x',
  revision: 4,
  config: {
    accent_color: '#D9D2C3',
    lighting: 'warm',
    guide_placements: [{ guide_id: 'guide_x', position: { x: 3, y: 0, z: -3 }, rotation_y: Math.PI / 2 }],
    lamp_slots: [
      { slot_id: 'a', position: { x: 3, y: 0, z: 4 } },
      { slot_id: 'b', position: { x: 9, y: 0, z: 4 } },
    ],
    npc_count: 12,
    installation_visible: true,
  },
  guides: [],
  lamp: { object_id: 'lamp_01', slot_id: 'a', holder_user_id: null, yaw: 0, head_pitch: 0, on: true },
}

test('roomToDraft: радианы в градусы, числа как строки', () => {
  const d = roomToDraft(runtime)
  expect(d.guides).toEqual([{ guide_id: 'guide_x', x: '3', z: '-3', rotation_deg: '90' }])
  expect(d.npc_count).toBe('12')
  expect(d.lighting).toBe('warm')
})

test('draftToConfig: круговой переход сохраняет места лампы и id гидов', () => {
  const config = draftToConfig(roomToDraft(runtime), runtime.config)
  expect(config.lamp_slots).toEqual(runtime.config.lamp_slots)
  expect(config.guide_placements[0].guide_id).toBe('guide_x')
  expect(config.guide_placements[0].rotation_y).toBeCloseTo(Math.PI / 2, 6)
  expect(config.npc_count).toBe(12)
  expect(config.installation_visible).toBe(true)
})

test('draftToConfig: 180° → −π, угол нормализуется в [−π, π)', () => {
  const d = roomToDraft(runtime)
  d.guides[0].rotation_deg = '180'
  expect(draftToConfig(d, runtime.config).guide_placements[0].rotation_y).toBeCloseTo(-Math.PI, 6)
  d.guides[0].rotation_deg = '270'
  expect(draftToConfig(d, runtime.config).guide_placements[0].rotation_y).toBeCloseTo(-Math.PI / 2, 6)
})

test('нули валидны и остаются нулями (x=0, npc_count=0)', () => {
  const d = roomToDraft(runtime)
  d.npc_count = '0'
  d.guides[0].x = '0'
  expect(validateRoomDraft(d)).toEqual({})
  const config = draftToConfig(d, runtime.config)
  expect(config.npc_count).toBe(0)
  expect(config.guide_placements[0].position.x).toBe(0)
})

test('validateRoomDraft: npc_count — целое 0–40', () => {
  for (const bad of ['41', '-1', '2.5', '', 'abc']) {
    const d = { ...roomToDraft(runtime), npc_count: bad }
    expect(validateRoomDraft(d).npc_count).toBeDefined()
  }
  expect(validateRoomDraft({ ...roomToDraft(runtime), npc_count: '40' }).npc_count).toBeUndefined()
})

test('validateRoomDraft: цвет только #RRGGBB, поля гида по ключу guide.<id>.<поле>', () => {
  expect(validateRoomDraft({ ...roomToDraft(runtime), accent_color: '#12345' }).accent_color).toBeDefined()
  expect(validateRoomDraft({ ...roomToDraft(runtime), accent_color: '#A1b2C3' }).accent_color).toBeUndefined()
  const d = roomToDraft(runtime)
  d.guides[0].x = ''
  d.guides[0].z = 'abc'
  d.guides[0].rotation_deg = 'Infinity'
  const errors = validateRoomDraft(d)
  expect(Object.keys(errors).sort()).toEqual(['guide.guide_x.rotation_deg', 'guide.guide_x.x', 'guide.guide_x.z'])
})

// --- таблица клиентов ---

const metric = (patch: Partial<SundayClientMetric> = {}): SundayClientMetric => ({
  user_id: 'u1',
  display_name: 'Анна',
  room_id: 'hall_antiquity',
  fps: 59.94,
  ping_ms: 12,
  visible: true,
  sampled_at: '2026-11-01T10:00:00Z',
  stale: false,
  ...patch,
})

test('clientRow: обычная строка', () => {
  expect(clientRow(metric())).toEqual({ name: 'Анна', room: 'hall_antiquity', fps: '59.9', ping: '12 мс' })
  expect(clientRow(metric({ fps: 60 })).fps).toBe('60')
})

test('clientRow: stale → «нет данных», пинг null → «—»', () => {
  expect(clientRow(metric({ stale: true, fps: null, visible: false })).fps).toBe('нет данных')
  expect(clientRow(metric({ ping_ms: null })).ping).toBe('—')
})

test('clientRow: скрытая вкладка не stale → «скрыта», а не «0» и не «нет данных»', () => {
  expect(clientRow(metric({ visible: false, fps: null, stale: false })).fps).toBe('скрыта')
})

test('draftToConfig: нетронутый угол гида не округляется до десятых градуса', () => {
  const rt = structuredClone(runtime)
  rt.config.guide_placements[0].rotation_y = 0.12345
  const config = draftToConfig(roomToDraft(rt), rt.config)
  expect(config.guide_placements[0].rotation_y).toBe(0.12345)
})

test('clientRow: дробный ping округляется до целых миллисекунд', () => {
  expect(clientRow(metric({ ping_ms: 0.30000001192092896 })).ping).toBe('0 мс')
  expect(clientRow(metric({ ping_ms: 12.6 })).ping).toBe('13 мс')
})
