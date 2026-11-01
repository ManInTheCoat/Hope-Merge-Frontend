import { expect, test } from 'bun:test'
import { canvasEncoder, encodeUnderLimit, fitFrame, type EncodeFn } from '../src/photo/frame'

test('fitFrame не трогает кадр, который уже помещается', () => {
  expect(fitFrame(1280, 720)).toEqual({ width: 1280, height: 720 })
})

test('fitFrame вписывает 2880×1620 в 1920×1080', () => {
  expect(fitFrame(2880, 1620)).toEqual({ width: 1920, height: 1080 })
})

test('fitFrame упирается в ту сторону, что вылезает сильнее (высокое окно)', () => {
  expect(fitFrame(1000, 2160)).toEqual({ width: 500, height: 1080 })
})

test('fitFrame не даёт нулевых сторон', () => {
  expect(fitFrame(5000, 1)).toEqual({ width: 1920, height: 1 })
})

test('encodeUnderLimit берёт первое качество, которое влезло', async () => {
  const calls: number[] = []
  const enc: EncodeFn = async (_w, _h, q) => {
    calls.push(q)
    return new Blob([new Uint8Array(q >= 0.7 ? 3e6 : 1e6)])
  }
  const b = await encodeUnderLimit(enc, 1920, 1080)
  expect(b.size).toBe(1e6)
  expect(calls).toEqual([0.9, 0.8, 0.7, 0.6])
})

test('encodeUnderLimit уменьшает размер вдвое, если не помогло качество', async () => {
  const sizes: string[] = []
  const enc: EncodeFn = async (w, h) => {
    sizes.push(`${w}x${h}`)
    return new Blob([new Uint8Array(w > 1000 ? 3e6 : 10)])
  }
  await encodeUnderLimit(enc, 1920, 1080)
  expect(sizes.at(-1)).toBe('960x540')
  expect(sizes.filter((s) => s === '1920x1080').length).toBe(6)
})

test('encodeUnderLimit сдаётся, когда сторона дошла до 1 px', async () => {
  const enc: EncodeFn = async () => new Blob([new Uint8Array(3e6)])
  await expect(encodeUnderLimit(enc, 4, 4)).rejects.toThrow()
})

test('canvasEncoder: масштабированный холст создаётся один раз на размер, а не на каждое качество', async () => {
  let created = 0
  const fakeCanvas = () => {
    created++
    return {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage() {} }),
      toBlob: (cb: (b: Blob) => void) => cb(new Blob([new Uint8Array(1)])),
    } as unknown as HTMLCanvasElement
  }
  const frame = { width: 1920, height: 1080, toBlob: (cb: (b: Blob) => void) => cb(new Blob()) } as unknown as HTMLCanvasElement
  const enc = canvasEncoder(frame, fakeCanvas)
  for (const q of [0.9, 0.8, 0.7, 0.6, 0.5, 0.4]) await enc(960, 540, q)
  expect(created).toBe(1)
  await enc(480, 270, 0.9)
  expect(created).toBe(2)
})
