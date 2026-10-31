const MIB = 1024 * 1024

/** Один знак после запятой, русский десятичный разделитель. */
function num(x: number): string {
  return x.toFixed(1).replace('.', ',')
}

/** «Кеш: 7,9% (3,3 / 42,0 МБ)». МБ — двоичные (1024²), как «3 МиБ» в api.md. */
export function formatCache(used: number, limit: number): string {
  const pct = limit > 0 ? (used / limit) * 100 : 0
  return `Кеш: ${num(pct)}% (${num(used / MIB)} / ${num(limit / MIB)} МБ)`
}

export function formatMemory(textures: number, geometries: number): string {
  return `Текстуры: ${textures} · Геометрии: ${geometries}`
}
