import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GUIDE_ACTION_EXAMPLES, GUIDE_ACTION_HINT, guideActionDoneText, guideActionErrorText, validateGuideAction } from '../src/ui/guideAction'
import { classifyGuideAction, normalizeGuideAction } from '../src/network/mock/lampSim'

test('текст просьбы: trim и 1–200 кодовых точек', () => {
  expect(validateGuideAction('  покажи макет ')).toBe('покажи макет')
  expect(validateGuideAction('   ')).toBeNull()
  expect(validateGuideAction('а'.repeat(200))).not.toBeNull()
  expect(validateGuideAction('а'.repeat(201))).toBeNull()
  expect(validateGuideAction('😀'.repeat(200))).not.toBeNull() // кодовые точки, не UTF-16
})

test('UNSUPPORTED_ACTION подсказывает примеры, и каждый пример гид действительно понимает', () => {
  const text = guideActionErrorText({ code: 'UNSUPPORTED_ACTION', message: 'x' })
  expect(text).toBe(GUIDE_ACTION_HINT)
  for (const phrase of GUIDE_ACTION_EXAMPLES) {
    expect(text).toContain(phrase)
    expect(classifyGuideAction(phrase)).not.toBeNull()
  }
})

test('прочие отказы — человеческие тексты без кодов', () => {
  expect(guideActionErrorText({ code: 'OUT_OF_RANGE', message: 'x' })).toBe('Подойдите ближе к гиду')
  expect(guideActionErrorText({ code: 'RATE_LIMITED', message: 'x', retry_after_ms: 1200 })).toBe('Слишком часто, подождите 2 с')
  expect(guideActionErrorText(new Error('SOCKET_CLOSED'))).not.toContain('SOCKET_CLOSED')
})

test('ответ по эффекту', () => {
  expect(guideActionDoneText('show_installation')).toContain('учебный макет')
  expect(guideActionDoneText('cool_light')).toContain('холоднее')
  expect(guideActionDoneText('что-то новое')).toBe('Готово')
})

test('классификатор: все фразы таблицы §6', () => {
  const table: Array<[string, string]> = [
    ['покажи макет', 'show_installation'],
    ['добавь макет', 'show_installation'],
    ['покажи учебный макет', 'show_installation'],
    ['убери макет', 'hide_installation'],
    ['скрой макет', 'hide_installation'],
    ['сделай освещение теплее', 'warm_light'],
    ['тёплый свет', 'warm_light'],
    ['сделай освещение холоднее', 'cool_light'],
    ['холодный свет', 'cool_light'],
  ]
  for (const [phrase, effect] of table) expect(classifyGuideAction(phrase)).toBe(effect)
})

test('классификатор: регистр, пробелы и завершающие .!?; нормализуются; остальное — нет', () => {
  expect(normalizeGuideAction('  ПОКАЖИ \t макет?!;. ')).toBe('покажи макет')
  expect(classifyGuideAction('  ПОКАЖИ   Макет!!! ')).toBe('show_installation')
  expect(classifyGuideAction('Тёплый свет.')).toBe('warm_light')
  expect(classifyGuideAction('покажи макет пожалуйста')).toBeNull()
  expect(classifyGuideAction('теплый свет')).toBeNull() // без ё это другая фраза
  expect(classifyGuideAction('покажи, макет')).toBeNull()
  expect(classifyGuideAction('')).toBeNull()
})

test('фикстура guide.action из контракта распознаётся', () => {
  const p = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures', 'sunday', 'guide.action.json'), 'utf8')).payload
  expect(classifyGuideAction(p.text)).toBe('show_installation')
})
