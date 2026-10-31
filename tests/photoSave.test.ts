import { expect, test } from 'bun:test'
import { ApiError } from '../src/network/api'
import type { Photo } from '../src/network/contract'
import { buildPhotoForm, PhotoTimeoutError, photoErrorText, savePhoto, type Shot, type Upload } from '../src/photo/save'

const photo = { id: 'p1' } as Photo
const shot = (over: Partial<Shot> = {}): Shot => ({
  key: 'k1',
  blob: new Blob(['x'], { type: 'image/jpeg' }),
  roomId: 'r1',
  epoch: 2,
  exhibitId: null,
  takenAt: new Date(),
  ...over,
})
const net = () => new TypeError('Failed to fetch')
const api = (status: number, code: string) => new ApiError(status, code, code)
const fast = { totalMs: 200, retryDelaysMs: [5, 5] }

type Call = { form: FormData; key: string; signal: AbortSignal }

/** Upload, который по очереди выдаёт ответы из списка: Error — бросает, иначе возвращает. */
function scripted(replies: (Photo | Error)[]): { upload: Upload; calls: Call[] } {
  const calls: Call[] = []
  const upload: Upload = async (form, key, signal) => {
    calls.push({ form, key, signal })
    const r = replies[calls.length - 1]
    if (r instanceof Error) throw r
    return r
  }
  return { upload, calls }
}

test('успех с первой попытки', async () => {
  const { upload, calls } = scripted([photo])
  expect((await savePhoto(shot(), upload, fast)).photo).toBe(photo)
  expect(calls.length).toBe(1)
})

test('сетевой сбой → повтор с тем же ключом, ответ 200 при повторе — успех', async () => {
  const { upload, calls } = scripted([net(), net(), photo])
  expect((await savePhoto(shot(), upload, fast)).photo).toBe(photo)
  expect(calls.map((c) => c.key)).toEqual(['k1', 'k1', 'k1'])
  expect(calls[2].form.get('room_id')).toBe('r1')
})

test('сетевой сбой: не больше двух повторов', async () => {
  const { upload, calls } = scripted([net(), net(), net(), photo])
  const err = await savePhoto(shot(), upload, fast).catch((e) => e)
  expect(err).toBeInstanceOf(TypeError)
  expect(calls.length).toBe(3)
})

test('ответ с кодом ошибки не повторяется', async () => {
  for (const e of [api(409, 'GAME_NOT_READY'), api(500, 'INTERNAL')]) {
    const { upload, calls } = scripted([e, photo])
    expect(await savePhoto(shot(), upload, fast).catch((x) => x)).toBe(e)
    expect(calls.length).toBe(1)
  }
})

test('OUT_OF_RANGE с exhibit_id → один повтор без экспоната и с новым ключом', async () => {
  const s = shot({ exhibitId: 'ex1' })
  const { upload, calls } = scripted([api(403, 'OUT_OF_RANGE'), photo])
  const fallbacks: Shot[] = []
  const res = await savePhoto(s, upload, { ...fast, onFallback: (x) => fallbacks.push(x) })
  expect(res.photo).toBe(photo)
  expect(calls.length).toBe(2)
  expect(calls[0].form.get('exhibit_id')).toBe('ex1')
  expect(calls[1].form.has('exhibit_id')).toBe(false)
  expect(calls[1].key).not.toBe('k1')
  // Переданный снимок не меняется: отправленный возвращается и сообщается отдельно.
  expect(s.key).toBe('k1')
  expect(s.exhibitId).toBe('ex1')
  expect(res.shot.key).toBe(calls[1].key)
  expect(res.shot.exhibitId).toBeNull()
  expect(fallbacks).toEqual([res.shot])
})

test('NOT_FOUND без exhibit_id не повторяется', async () => {
  const e = api(404, 'NOT_FOUND')
  const { upload, calls } = scripted([e, photo])
  expect(await savePhoto(shot(), upload, fast).catch((x) => x)).toBe(e)
  expect(calls.length).toBe(1)
})

test('откат без экспоната только один раз', async () => {
  const s = shot({ exhibitId: 'ex1' })
  const e = api(403, 'OUT_OF_RANGE')
  const { upload, calls } = scripted([api(404, 'NOT_FOUND'), e, photo])
  expect(await savePhoto(s, upload, fast).catch((x) => x)).toBe(e)
  expect(calls.length).toBe(2)
})

test('общий таймаут обрывает запрос и повторы', async () => {
  const calls: AbortSignal[] = []
  const upload: Upload = (_f, _k, signal) => {
    calls.push(signal)
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
  }
  const err = await savePhoto(shot(), upload, { totalMs: 30, retryDelaysMs: [5, 5] }).catch((e) => e)
  expect(err).toBeInstanceOf(PhotoTimeoutError)
  expect(calls.length).toBe(1)
  expect(calls[0].aborted).toBe(true)
})

test('таймаут во время паузы перед повтором не запускает новую попытку', async () => {
  const { upload, calls } = scripted([net(), photo])
  const err = await savePhoto(shot(), upload, { totalMs: 20, retryDelaysMs: [200] }).catch((e) => e)
  expect(err).toBeInstanceOf(PhotoTimeoutError)
  await new Promise((r) => setTimeout(r, 250))
  expect(calls.length).toBe(1)
})

test('внешний signal прекращает попытки', async () => {
  const ac = new AbortController()
  const { upload, calls } = scripted([net(), photo])
  const p = savePhoto(shot(), upload, { ...fast, retryDelaysMs: [50], signal: ac.signal })
  setTimeout(() => ac.abort(), 10)
  const err = await p.catch((e) => e)
  expect(err.name).toBe('AbortError')
  await new Promise((r) => setTimeout(r, 80))
  expect(calls.length).toBe(1)
})

test('buildPhotoForm: поля по api.md, без caption, epoch строкой', () => {
  const f = buildPhotoForm(shot({ exhibitId: 'ex1' }))
  expect([...f.keys()].sort()).toEqual(['exhibit_id', 'image', 'movement_epoch', 'room_id'])
  expect(f.get('movement_epoch')).toBe('2')
  expect(f.get('image')).toBeInstanceOf(Blob)
  expect([...buildPhotoForm(shot()).keys()]).not.toContain('exhibit_id')
})

test('photoErrorText', () => {
  expect(photoErrorText(new ApiError(429, 'RATE_LIMITED', 'x', { retry_after_ms: 2500 }))).toBe('Слишком часто, подождите 3 с')
  expect(photoErrorText(new ApiError(429, 'RATE_LIMITED', 'x'))).toBe('Слишком часто, подождите 1 с')
  expect(photoErrorText(new PhotoTimeoutError())).toBe('Сервер не ответил')
  expect(photoErrorText(net())).toBe('Нет связи с сервером')
  expect(photoErrorText(new ApiError(409, 'GAME_NOT_READY', 'Игра не готова'))).toBe('Игра не готова')
})
