import { ApiError } from '../network/api'
import { userErrorText } from '../ui/errorText'

export type ConflictCode = 'REVISION_CONFLICT' | 'OBJECT_BUSY'

export type SaveResult<T> =
  | { kind: 'saved'; value: T }
  /** Правка не применена, `value` — актуальное состояние, перечитанное после конфликта. */
  | { kind: 'conflict'; code: ConflictCode; value: T }
  | { kind: 'error'; text: string; fields?: Record<string, string> }

const isConflict = (e: unknown): e is ApiError & { code: ConflictCode } =>
  e instanceof ApiError && (e.code === 'REVISION_CONFLICT' || e.code === 'OBJECT_BUSY')

/**
 * Сохраняет правку админки (api-sunday.md §3): при проигранном CAS или занятой лампе ничего не затирает,
 * а перечитывает состояние и возвращает его для показа. Остальные ошибки превращаются в текст для администратора.
 */
export async function saveOrReload<T>(save: () => Promise<T>, reload: () => Promise<T>): Promise<SaveResult<T>> {
  try {
    return { kind: 'saved', value: await save() }
  } catch (e) {
    if (!isConflict(e)) return failure(e)
    try {
      return { kind: 'conflict', code: e.code, value: await reload() }
    } catch (reloadError) {
      return failure(reloadError)
    }
  }
}

function failure(e: unknown): SaveResult<never> {
  const fields = e instanceof ApiError ? e.fields : undefined
  return { kind: 'error', text: userErrorText(e), ...(fields ? { fields } : {}) }
}
