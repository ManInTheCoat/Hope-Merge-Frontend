import { expect, test } from 'bun:test'
import type { Generation, GenerationStatus } from '../src/network/contract'
import { askErrorText, failureText, GuideAsks, validateGuideText } from '../src/ui/guideAsks'

function gen(id: string, status: GenerationStatus, extra: Partial<Generation> = {}): Generation {
  return {
    id,
    request_id: `r_${id}`,
    guide_id: 'g1',
    exhibit_id: null,
    status,
    user_message: { id: `u_${id}`, role: 'user', text: `вопрос ${id}`, created_at: '' },
    assistant_message: null,
    error: null,
    ...extra,
  }
}

const answer = (text: string) => ({ id: 'a', role: 'assistant' as const, text, created_at: '' })

function asking(asks = new GuideAsks()) {
  asks.start({ requestId: 'r1', guideId: 'g1', guideName: 'Гид', question: 'Кто автор?' })
  return asks
}

const live = (status: GenerationStatus, extra: Partial<Generation> = {}) =>
  gen('gen1', status, { request_id: 'r1', user_message: { id: 'u', role: 'user', text: 'Кто автор?', created_at: '' }, ...extra })

test('вопрос до accepted — waiting, отменить нельзя', () => {
  const asks = asking()
  expect(asks.entries('g1', [])).toEqual([{ key: 'r1', question: 'Кто автор?', answer: '', state: 'waiting', note: null }])
  expect(asks.status('g1')).toEqual({ text: 'Ожидание…', canCancel: false })
})

test('accepted queued → started → delta → «Гид отвечает…» и текст потока', () => {
  const asks = asking()
  asks.accepted('r1', live('queued'))
  expect(asks.status('g1')).toEqual({ text: 'Ожидание…', canCancel: true })
  asks.started('gen1')
  asks.delta('gen1', 0, 'Шиш')
  asks.delta('gen1', 1, 'кин')
  expect(asks.status('g1')?.text).toBe('Гид отвечает…')
  expect(asks.entries('g1', [])[0]).toMatchObject({ key: 'gen1', state: 'answering', answer: 'Шишкин' })
})

test('accepted running сразу даёт «Гид отвечает…»', () => {
  const asks = asking()
  asks.accepted('r1', live('running'))
  expect(asks.status('g1')?.text).toBe('Гид отвечает…')
})

test('completed заменяет поток итоговым текстом и освобождает поле', () => {
  const asks = asking()
  asks.accepted('r1', live('queued'))
  asks.delta('gen1', 0, 'черно')
  asks.finished(live('completed', { assistant_message: answer('Иван Шишкин') }))
  expect(asks.active).toBeNull()
  expect(asks.status('g1')).toBeNull()
  expect(asks.entries('g1', [])).toEqual([{ key: 'gen1', question: 'Кто автор?', answer: 'Иван Шишкин', state: 'done', note: null }])
})

test('failed CANCELLED: частичного текста нет (в историю он не попадает), пометка «Отменено»', () => {
  const asks = asking()
  asks.accepted('r1', live('running'))
  asks.delta('gen1', 0, 'Это ')
  asks.finished(live('failed', { error: { code: 'CANCELLED', message: 'x', retryable: false } }))
  expect(asks.active).toBeNull()
  expect(asks.entries('g1', [])[0]).toMatchObject({ state: 'failed', answer: '', note: 'Отменено' })
})

test('accepted уже completed сразу завершает вопрос', () => {
  const asks = asking()
  asks.accepted('r1', live('completed', { assistant_message: answer('Готово') }))
  expect(asks.active).toBeNull()
  expect(asks.entries('g1', [])[0]).toMatchObject({ state: 'done', answer: 'Готово' })
})

test('delta с чужим generation_id игнорируется', () => {
  const asks = asking()
  asks.accepted('r1', live('running'))
  asks.delta('other', 0, 'чужое')
  expect(asks.entries('g1', [])[0].answer).toBe('')
})

test('после reset поздние delta и completed ничего не меняют', () => {
  const asks = asking()
  asks.accepted('r1', live('running'))
  asks.reset()
  asks.delta('gen1', 0, 'поздно')
  asks.finished(live('completed', { assistant_message: answer('поздно') }))
  expect(asks.active).toBeNull()
  expect(asks.entries('g1', [])).toEqual([])
})

test('rejected возвращает текст вопроса и гида и снимает его; чужой request_id → null', () => {
  const asks = asking()
  expect(asks.rejected('zzz')).toBeNull()
  expect(asks.active).not.toBeNull()
  expect(asks.rejected('r1')).toEqual({ question: 'Кто автор?', guideId: 'g1' })
  expect(asks.active).toBeNull()
  expect(asks.entries('g1', [])).toEqual([])
})

test('rejected после accepted не снимает вопрос', () => {
  const asks = asking()
  asks.accepted('r1', live('queued'))
  expect(asks.rejected('r1')).toBeNull()
  expect(asks.active?.generationId).toBe('gen1')
})

test('статус у другого гида — «Ждём ответ: Гид»', () => {
  const asks = asking()
  asks.accepted('r1', live('running'))
  expect(asks.status('g2')).toEqual({ text: 'Ждём ответ: Гид', canCancel: true })
  expect(asks.entries('g2', [])).toEqual([])
})

test('во время отмены кнопка неактивна', () => {
  const asks = asking()
  asks.accepted('r1', live('running'))
  asks.setCancelling(true)
  expect(asks.cancelling).toBe(true)
  expect(asks.status('g1')?.canCancel).toBe(false)
})

test('история: живая версия заменяет запись с тем же id, новые живые идут в конце', () => {
  const asks = asking()
  asks.accepted('r1', live('running'))
  asks.delta('gen1', 0, 'поток')
  const history = [
    gen('old', 'completed', { assistant_message: answer('давно') }),
    live('running'),
    gen('q', 'queued'),
  ]
  const entries = asks.entries('g1', history)
  expect(entries.map((e) => [e.key, e.state, e.answer])).toEqual([
    ['old', 'done', 'давно'],
    ['gen1', 'answering', 'поток'],
    ['q', 'waiting', ''],
  ])
})

test('завершённые ответы идут после истории в порядке завершения, перед активным', () => {
  const asks = new GuideAsks()
  asks.start({ requestId: 'ra', guideId: 'g1', guideName: 'К', question: 'A' })
  asks.accepted('ra', gen('a', 'queued', { request_id: 'ra' }))
  asks.finished(gen('a', 'completed', { request_id: 'ra', assistant_message: answer('1') }))
  asks.start({ requestId: 'rb', guideId: 'g1', guideName: 'К', question: 'B' })
  expect(asks.entries('g1', []).map((e) => e.key)).toEqual(['a', 'rb'])
})

test('onChange вызывается на start, delta и finished', () => {
  const asks = new GuideAsks()
  let calls = 0
  const off = asks.onChange(() => calls++)
  asking(asks)
  asks.accepted('r1', live('running'))
  asks.delta('gen1', 0, 'x')
  asks.finished(live('completed', { assistant_message: answer('x') }))
  expect(calls).toBe(4)
  off()
  asks.reset()
  expect(calls).toBe(4)
})

test('validateGuideText: пробелы → null, 2000 кодовых точек ок, 2001 → null', () => {
  expect(validateGuideText('   ')).toBeNull()
  expect(validateGuideText('  привет ')).toBe('привет')
  expect(validateGuideText('😀'.repeat(2000))).toBe('😀'.repeat(2000))
  expect(validateGuideText('a'.repeat(2001))).toBeNull()
})

test('askErrorText по кодам', () => {
  expect(askErrorText({ code: 'OUT_OF_RANGE', message: 'x' })).toBe('Подойдите ближе к гиду')
  expect(askErrorText({ code: 'GUIDE_BUSY', message: 'x' })).toBe('Гид ещё отвечает на прошлый вопрос')
  expect(askErrorText({ code: 'GUIDE_QUEUE_FULL', message: 'x' })).toBe('Гиды заняты, попробуйте через 5 с')
  expect(askErrorText({ code: 'GUIDE_QUEUE_FULL', message: 'x', retry_after_ms: 2500 })).toBe('Гиды заняты, попробуйте через 3 с')
  expect(askErrorText({ code: 'RATE_LIMITED', message: 'x', retry_after_ms: 4000 })).toBe('Слишком часто, подождите 4 с')
  expect(askErrorText({ code: 'VALIDATION_ERROR', message: 'Текст 1–2000 символов' })).toBe('Текст 1–2000 символов')
  expect(askErrorText({})).toBe('Что-то пошло не так')
})

test('failureText по кодам', () => {
  const e = (code: string) => ({ code, message: 'серверный текст', retryable: false })
  expect(failureText(e('CANCELLED'))).toBe('Отменено')
  expect(failureText(e('SERVER_RESTARTED'))).toBe('Сервер перезапускался')
  expect(failureText(e('AI_TIMEOUT'))).toBe('Гид не успел ответить')
  expect(failureText(e('AI_UNAVAILABLE'))).toBe('Гид сейчас недоступен')
  expect(failureText(e('AI_OUTPUT_LIMIT'))).toBe('Ответ оказался слишком длинным')
  expect(failureText(e('OTHER'))).toBe('серверный текст')
  expect(failureText(null)).toBe('Ответ не получен')
})

test('тайм-аут ask, генерация найдена по request_id: продолжаем с её статусом, отмена доступна', () => {
  const asks = asking()
  expect(asks.recover('r1', live('running'))).toBeNull()
  expect(asks.status('g1')).toEqual({ text: 'Гид отвечает…', canCancel: true })
})

test('тайм-аут ask, генерации нет (404): вопрос снят, текст возвращается', () => {
  const asks = asking()
  expect(asks.recover('r1', null)).toEqual({ question: 'Кто автор?', guideId: 'g1' })
  expect(asks.active).toBeNull()
})

test('поздний guide.accepted после тайм-аута не теряется, пока идёт восстановление', () => {
  const asks = asking()
  asks.accepted('r1', live('queued'))
  expect(asks.active?.generationId).toBe('gen1')
  expect(asks.recover('r1', live('queued'))).toBeNull() // повтор того же — без изменений
  expect(asks.status('g1')?.canCancel).toBe(true)
})

test('пропуск индекса в guide.delta: onGap один раз на генерацию', () => {
  const gaps: string[] = []
  const asks = asking(new GuideAsks({ onGap: (id) => gaps.push(id) }))
  asks.accepted('r1', live('running'))
  asks.delta('gen1', 0, 'А')
  asks.delta('gen1', 2, 'В')
  asks.delta('gen1', 3, 'Г')
  expect(gaps).toEqual(['gen1'])
})
