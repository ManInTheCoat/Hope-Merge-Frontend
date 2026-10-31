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

/** Отпечаток запроса для идемпотентности: размер файла и нормализованные поля. */
export function photoFingerprint(form: FormData): string {
  const image = form.get('image')
  return JSON.stringify([
    image instanceof Blob ? image.size : -1,
    form.get('room_id'),
    form.get('movement_epoch'),
    form.get('caption') ?? '',
    form.get('exhibit_id') ?? '',
  ])
}
