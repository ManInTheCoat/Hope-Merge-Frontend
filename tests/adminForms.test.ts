import { expect, test } from 'bun:test'
import { draftToSettings, guideToDraft, validateGuideDraft, type GuideDraft } from '../src/admin/guideForm'
import { saveOrReload } from '../src/admin/saveFlow'
import { ApiError } from '../src/network/api'
import { NO_CONNECTION } from '../src/ui/errorText'
import type { SundayAdminGuide } from '../src/network/sunday'

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
