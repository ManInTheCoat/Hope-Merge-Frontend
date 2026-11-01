const ALLOWED = new Set(['image', 'room_id', 'movement_epoch', 'caption', 'exhibit_id'])

/** Проверка multipart `POST /photos` по api.md: текст ошибки или null. */
export function checkPhotoForm(form: FormData): string | null {
  const seen = new Set<string>()
  for (const key of form.keys()) {
    if (!ALLOWED.has(key)) return `Неизвестное поле ${key}`
    if (seen.has(key)) return `Поле ${key} повторяется`
    seen.add(key)
  }
  if (!(form.get('image') instanceof Blob)) return 'Нужен файл image'
  if (typeof form.get('room_id') !== 'string') return 'Нужен room_id'
  const epoch = form.get('movement_epoch')
  if (typeof epoch !== 'string' || !/^\d+$/.test(epoch)) return 'movement_epoch — десятичное целое'
  return null
}

/** Отпечаток запроса для идемпотентности: SHA-256 содержимого файла и нормализованные поля (api.md §8). */
export async function photoFingerprint(form: FormData): Promise<string> {
  const image = form.get('image')
  let hash = ''
  if (image instanceof Blob) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await image.arrayBuffer()))
    hash = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  return JSON.stringify([
    hash,
    form.get('room_id'),
    form.get('movement_epoch'),
    form.get('caption') ?? '',
    form.get('exhibit_id') ?? '',
  ])
}
