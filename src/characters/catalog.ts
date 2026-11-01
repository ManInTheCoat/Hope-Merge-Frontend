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

export type Accessory = 'boater' | 'straw-wide' | 'beret' | 'beard-white' | 'beard-grey' | 'beard-red'

export type GuideLook = { model: string; outfit: string; accessories: Accessory[]; accent: string }

const LOOKS: { ids: string[]; names: string[]; look: GuideLook }[] = [
  {
    ids: ['guide_monet'],
    names: ['моне'],
    look: { model: 'character-male-c', outfit: '#e9e4d4', accessories: ['boater', 'beard-white'], accent: '#5f9ea0' },
  },
  {
    ids: ['guide_da_vinci', 'guide_leonardo'],
    names: ['леонардо', 'винчи'],
    look: { model: 'character-male-e', outfit: '#8a3b2a', accessories: ['beret', 'beard-grey'], accent: '#b8863b' },
  },
  {
    ids: ['guide_van_gogh'],
    names: ['ван гог'],
    look: { model: 'character-male-b', outfit: '#2f4f8f', accessories: ['straw-wide', 'beard-red'], accent: '#e0b020' },
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

/** Клип по скорости, м/с. Скорость выше человеческой — телепорт сервера, а не бег. */
export function clipForSpeed(mps: number): Clip {
  if (mps < 0.3 || mps > 6) return 'idle'
  return mps < 2.6 ? 'walk' : 'sprint'
}
