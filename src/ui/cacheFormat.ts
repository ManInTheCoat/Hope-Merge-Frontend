const MIB = 1024 * 1024

/** Один знак после запятой, русский десятичный разделитель. */
function num(x: number): string {
  return x.toFixed(1).replace('.', ',')
}

/**
 * «Кеш: 2,6% мира (1,2 / 47,0 МБ, лимит 10%)»: процент от всего контента мира, как в требовании «не более 10%».
 * МБ — двоичные (1024²), как «3 МиБ» в api.md.
 */
export function formatCache(used: number, total: number, limit: number): string {
  const pct = total > 0 ? (used / total) * 100 : 0
  const limitPct = total > 0 ? Math.round((limit / total) * 100) : 0
  return `Кеш: ${num(pct)}% мира (${num(used / MIB)} / ${num(total / MIB)} МБ, лимит ${limitPct}%)`
}

export function formatMemory(textures: number, geometries: number): string {
  return `Текстуры: ${textures} · Геометрии: ${geometries}`
}
