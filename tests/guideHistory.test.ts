import { expect, test } from 'bun:test'
import type { Generation } from '../src/network/contract'
import { mergeOlderPage } from '../src/ui/guidePanel'

const g = (id: string) => ({ id }) as Generation

test('страница старее склеивается спереди без дублей, порядок от старых к новым', () => {
  const history = [g('c'), g('d'), g('e')]
  expect(mergeOlderPage(history, [g('a'), g('b'), g('c')]).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
})

test('пустая страница ничего не меняет', () => {
  const history = [g('a')]
  expect(mergeOlderPage(history, [])).toEqual(history)
})
