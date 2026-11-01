const THUMB_MAX_BYTES = 128 * 1024
const THUMB_SIDE = 320

/**
 * Миниатюра для мока: JPEG с длинной стороной ≤320 px (как у сервера, api.md «Фото»). Без канваса
 * (тесты в bun) берётся начало файла в пределах 128 КиБ — размер верный, картинка условная.
 */
export async function makeThumbnail(file: Blob): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined') {
    try {
      const bitmap = await createImageBitmap(file)
      const k = Math.min(1, THUMB_SIDE / Math.max(bitmap.width, bitmap.height))
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * k)), Math.max(1, Math.round(bitmap.height * k)))
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        bitmap.close()
        const thumb = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 })
        if (thumb.size <= THUMB_MAX_BYTES) return thumb
      } else bitmap.close()
    } catch {
      // файл не декодируется — ниже условная миниатюра
    }
  }
  return file.slice(0, THUMB_MAX_BYTES, 'image/jpeg')
}
