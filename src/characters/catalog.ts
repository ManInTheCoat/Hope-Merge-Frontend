/** Модели пака Kenney Mini Characters (CC0), лежат в `public/characters/`. */
export const MODEL_IDS: readonly string[] = [
  ...['a', 'b', 'c', 'd', 'e', 'f'].map((l) => `character-male-${l}`),
  ...['a', 'b', 'c', 'd', 'e', 'f'].map((l) => `character-female-${l}`),
]

/** Детерминированный выбор модели: один и тот же человек выглядит одинаково у всех клиентов. */
export function pickModel(key: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return MODEL_IDS[(h >>> 0) % MODEL_IDS.length]
}

export type Accessory = 'boater' | 'straw-wide' | 'beret'

/** `outfit` тонирует одежду (умножается на палитру модели), null — родные цвета. */
export type GuideLook = { model: string; outfit: string | null; accessories: Accessory[]; accent: string }

const LOOKS: { ids: string[]; names: string[]; look: GuideLook }[] = [
  {
    ids: ['guide_monet'],
    names: ['моне'],
    // Своя борода у модели male-b; канотье поверх лысины.
    look: { model: 'character-male-b', outfit: null, accessories: ['boater'], accent: '#5f9ea0' },
  },
  {
    ids: ['guide_leonardo'],
    names: ['леонардо', 'винчи'],
    // Та же бородатая модель, но тёмный берет и красно-коричневая одежда.
    look: { model: 'character-male-b', outfit: '#a0522d', accessories: ['beret'], accent: '#b8863b' },
  },
  {
    ids: ['guide_vangogh'],
    names: ['ван гог'],
    // Рыжие волосы модели male-d и соломенная шляпа.
    look: { model: 'character-male-d', outfit: null, accessories: ['straw-wide'], accent: '#e0b020' },
  },
]

/** Внешность согласованной личности: сначала по id, затем по имени. Незнакомый гид — null. */
export function guideLook(id: string, displayName: string): GuideLook | null {
  const byId = LOOKS.find((l) => l.ids.includes(id))
  if (byId) return byId.look
  const name = displayName.toLowerCase()
  return LOOKS.find((l) => l.names.some((n) => name.includes(n)))?.look ?? null
}

export type Clip = 'idle' | 'walk' | 'sprint'

/**
 * Клип по скорости, м/с. Обычный шаг клиента — 3,6 м/с (90% от 4), это ходьба; бег — только выше
 * максимума сервера. Скорость выше человеческой — телепорт сервера, а не бег.
 */
export function clipForSpeed(mps: number): Clip {
  if (mps < 0.3 || mps > 6) return 'idle'
  return mps <= 4.2 ? 'walk' : 'sprint'
}
