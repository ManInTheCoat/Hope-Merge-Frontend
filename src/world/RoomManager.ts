import { ContentError } from '../network/api'
import type { Room, RoomPackage } from '../network/contract'

export { ContentError }

export type LoadedRoom = { room: Room; bitmaps: Map<string, ImageBitmap> }

export type RoomManagerDeps = {
  version: string
  /** `maxBytes` — объявленный размер: загрузка обязана прерваться, как только он превышен. */
  fetchRoomText: (roomId: string, version: string, maxBytes: number, signal?: AbortSignal) => Promise<string>
  fetchAssetBlob: (assetId: string, version: string, maxBytes: number, signal?: AbortSignal) => Promise<Blob>
  decode: (blob: Blob) => Promise<ImageBitmap>
  /** Точка подключения будущего AssetBudget: объявленный и фактический размер каждого файла. */
  onBytes?: (kind: 'descriptor' | 'asset', id: string, declared: number, actual: number) => void
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError')
}

export class RoomManager {
  private loaded: LoadedRoom | null = null
  private readonly deps: RoomManagerDeps

  constructor(deps: RoomManagerDeps) {
    this.deps = deps
  }

  get current(): LoadedRoom | null {
    return this.loaded
  }

  async load(pkg: RoomPackage, signal: AbortSignal): Promise<LoadedRoom> {
    this.unload()
    const { deps } = this
    // Внутренний сигнал: отменяет все загрузки и при внешней отмене, и при первом сбое любой из них.
    const inner = new AbortController()
    const onOuterAbort = () => inner.abort()
    signal.addEventListener('abort', onOuterAbort)
    if (signal.aborted) inner.abort()
    const failFast = <T>(p: Promise<T>): Promise<T> =>
      p.catch((e) => {
        inner.abort()
        throw e
      })
    const bitmaps = new Map<string, ImageBitmap>()
    const closeAll = () => {
      bitmaps.forEach((b) => b.close())
      bitmaps.clear()
    }

    const loadRoom = async (): Promise<Room> => {
      const text = await deps.fetchRoomText(pkg.room_id, deps.version, pkg.descriptor_bytes, inner.signal)
      const actual = new TextEncoder().encode(text).length
      deps.onBytes?.('descriptor', pkg.room_id, pkg.descriptor_bytes, actual)
      if (actual > pkg.descriptor_bytes) throw new ContentError(`Описание зала больше объявленного: ${actual} > ${pkg.descriptor_bytes}`)
      const room = JSON.parse(text) as Room
      if (room.id !== pkg.room_id) throw new ContentError(`Зал ${room.id} вместо ${pkg.room_id}`)
      return room
    }

    const loadAsset = async (asset: RoomPackage['assets'][number]): Promise<void> => {
      const blob = await deps.fetchAssetBlob(asset.id, deps.version, asset.bytes, inner.signal)
      deps.onBytes?.('asset', asset.id, asset.bytes, blob.size)
      if (blob.size > asset.bytes) throw new ContentError(`Ресурс ${asset.id} больше объявленного: ${blob.size} > ${asset.bytes}`)
      const bitmap = await deps.decode(blob)
      if (inner.signal.aborted) {
        bitmap.close()
        return
      }
      bitmaps.set(asset.id, bitmap)
    }

    const results = await Promise.allSettled([failFast(loadRoom()), ...pkg.assets.map((a) => failFast(loadAsset(a)))])
    signal.removeEventListener('abort', onOuterAbort)
    // Первая по времени настоящая ошибка, а не AbortError соседей, которых она отменила.
    const failure =
      results.find((r) => r.status === 'rejected' && (r.reason as Error)?.name !== 'AbortError') ??
      results.find((r) => r.status === 'rejected')
    if (failure || signal.aborted) {
      closeAll()
      if (failure) throw (failure as PromiseRejectedResult).reason
      throw abortError()
    }

    this.loaded = { room: (results[0] as PromiseFulfilledResult<Room>).value, bitmaps }
    return this.loaded
  }

  unload(): void {
    this.loaded?.bitmaps.forEach((b) => b.close())
    this.loaded = null
  }
}
