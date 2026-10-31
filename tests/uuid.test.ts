import { expect, test } from 'bun:test'
import { uuidV4 } from '../src/network/uuid'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

test('uuidV4 даёт UUID версии 4', () => {
  expect(uuidV4()).toMatch(UUID_V4)
})

test('uuidV4 работает без crypto.randomUUID (не secure context)', () => {
  const original = crypto.randomUUID
  Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true })
  try {
    const ids = new Set(Array.from({ length: 50 }, () => uuidV4()))
    expect(ids.size).toBe(50)
    for (const id of ids) expect(id).toMatch(UUID_V4)
  } finally {
    Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true })
  }
})
