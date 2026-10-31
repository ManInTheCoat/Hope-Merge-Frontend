/** Предел одного оригинала фото (api.md, «Фото»). */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024

const MAX_W = 1920
const MAX_H = 1080
const QUALITIES = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4]

/** Кадр, вписанный в 1920×1080 с сохранением пропорций; меньший кадр не увеличивается. */
export function fitFrame(width: number, height: number, maxW = MAX_W, maxH = MAX_H): { width: number; height: number } {
  const k = Math.min(1, maxW / width, maxH / height)
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) }
}

export type EncodeFn = (width: number, height: number, quality: number) => Promise<Blob>

/**
 * Сжимает кадр до `maxBytes`: сначала снижает качество, затем вдвое уменьшает размер и начинает
 * с лучшего качества заново.
 */
export async function encodeUnderLimit(encode: EncodeFn, width: number, height: number, maxBytes = MAX_PHOTO_BYTES): Promise<Blob> {
  let w = width
  let h = height
  for (;;) {
    for (const q of QUALITIES) {
      const blob = await encode(w, h, q)
      if (blob.size <= maxBytes) return blob
    }
    if (w <= 1 || h <= 1) throw new Error('Не удалось сжать кадр до 2 МиБ')
    w = Math.max(1, Math.round(w / 2))
    h = Math.max(1, Math.round(h / 2))
  }
}

/**
 * Синхронная копия только что отрисованного WebGL-кадра в 2D-canvas нужного размера.
 * Вызывать сразу после `renderer.render()` в том же участке кода: буфер ещё не очищен,
 * `preserveDrawingBuffer` не нужен.
 */
export function copyFrame(source: HTMLCanvasElement): HTMLCanvasElement {
  const { width, height } = fitFrame(source.width, source.height)
  const frame = document.createElement('canvas')
  frame.width = width
  frame.height = height
  frame.getContext('2d')!.drawImage(source, 0, 0, width, height)
  return frame
}

export function canvasEncoder(frame: HTMLCanvasElement): EncodeFn {
  return (width, height, quality) => {
    let src = frame
    if (width !== frame.width || height !== frame.height) {
      src = document.createElement('canvas')
      src.width = width
      src.height = height
      src.getContext('2d')!.drawImage(frame, 0, 0, width, height)
    }
    return new Promise<Blob>((resolve, reject) =>
      src.toBlob((b) => (b ? resolve(b) : reject(new Error('Не удалось закодировать кадр'))), 'image/jpeg', quality),
    )
  }
}
