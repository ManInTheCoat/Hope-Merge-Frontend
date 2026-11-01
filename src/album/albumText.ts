import type { Photo } from '../network/contract'
import { photoFileName } from '../photo/lastPhoto'

export const SHARE_CONFIRM_TEXT = 'Фото увидят все игроки, отменить публикацию нельзя.'
export const EMPTY_ALBUM_TEXT = 'Пока нет фото. Сделайте снимок клавишей F.'

/** Почему нельзя отправить фото в чат прямо сейчас, или `null`, если можно. */
export function shareBlockReason(ctx: { ready: boolean; socketOpen: boolean }): string | null {
  return ctx.ready && ctx.socketOpen ? null : 'Отправка в чат доступна, когда игра подключена'
}

export function photoMeta(photo: Photo, timeZone?: string): { caption: string; room: string; date: string } {
  const date = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(photo.created_at))
  return { caption: photo.caption || 'Без подписи', room: photo.room_id, date }
}

export function albumFileName(photo: Photo): string {
  return photoFileName(photo.room_id, new Date(photo.created_at))
}
