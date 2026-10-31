import type { Room, RoomPackage } from '../network/contract'

export class ContentError extends Error {}

export type LoadedRoom = { room: Room; bitmaps: Map<string, ImageBitmap> }

export type RoomManagerDeps = {
  version: string
  fetchRoomText: (roomId: string, version: string, signal?: AbortSignal) => Promise<string>
  fetchAssetBlob: (assetId: string, version: string, signal?: AbortSignal) => Promise<Blob>
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
    const bitmaps = new Map<string, ImageBitmap>()
    const closeAll = () => {
      bitmaps.forEach((b) => b.close())
      bitmaps.clear()
    }

    const loadRoom = async (): Promise<Room> => {
      const text = await deps.fetchRoomText(pkg.room_id, deps.version, signal)
      const actual = new TextEncoder().encode(text).length
      deps.onBytes?.('descriptor', pkg.room_id, pkg.descriptor_bytes, actual)
      if (actual > pkg.descriptor_bytes) throw new ContentError(`Описание зала больше объявленного: ${actual} > ${pkg.descriptor_bytes}`)
      const room = JSON.parse(text) as Room
      if (room.id !== pkg.room_id) throw new ContentError(`Зал ${room.id} вместо ${pkg.room_id}`)
      return room
    }

    const loadAsset = async (asset: RoomPackage['assets'][number]): Promise<void> => {
      const blob = await deps.fetchAssetBlob(asset.id, deps.version, signal)
      deps.onBytes?.('asset', asset.id, asset.bytes, blob.size)
      if (blob.size > asset.bytes) throw new ContentError(`Ресурс ${asset.id} больше объявленного: ${blob.size} > ${asset.bytes}`)
      const bitmap = await deps.decode(blob)
      if (signal.aborted) {
        bitmap.close()
        return
      }
      bitmaps.set(asset.id, bitmap)
    }

    const results = await Promise.allSettled([loadRoom(), ...pkg.assets.map(loadAsset)])
    const failure = results.find((r) => r.status === 'rejected')
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
