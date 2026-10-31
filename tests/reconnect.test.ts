import { expect, test } from 'bun:test'
import { closeAction, ReconnectLoop, retryDelayMs, type ConnectResult, type LinkState } from '../src/network/reconnect'

test('closeAction по таблице api.md §4', () => {
  const table: Array<[number, string]> = [
    [1000, 'stop'],
    [1003, 'stop'],
    [1006, 'retry'],
    [1008, 'stop'],
    [1009, 'stop'],
    [1011, 'retry'],
    [1012, 'retry'],
    [1013, 'retry'],
    [4001, 'login'],
    [4006, 'update'],
    [4009, 'replaced'],
    [4999, 'retry'],
  ]
  for (const [code, action] of table) expect([code, closeAction(code)]).toEqual([code, action])
})

test('retryDelayMs: 1, 2, 4, 8, затем 10 с с разбросом ±20%', () => {
  expect([0, 1, 2, 3, 4, 5].map((a) => retryDelayMs(a, () => 0))).toEqual([800, 1600, 3200, 6400, 8000, 8000])
  expect([0, 1, 2, 3, 4, 5].map((a) => retryDelayMs(a, () => 1))).toEqual([1200, 2400, 4800, 9600, 12000, 12000])
  expect(retryDelayMs(2, () => 0.5)).toBe(4000)
})

function harness(results: Array<ConnectResult>, me: Array<'ok' | 'unauthenticated' | 'network'> = []) {
  const states: LinkState[] = []
  const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = []
  let connects = 0
  let t = 1000
  const loop = new ReconnectLoop({
    connect: async () => {
      connects++
      return results.shift() ?? { ok: true }
    },
    checkMe: async () => me.shift() ?? 'ok',
    schedule: (fn, ms) => {
      const timer = { fn, ms, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
    now: () => t,
    rand: () => 0.5,
    onState: (s) => states.push(s),
  })
  const fire = async () => {
    const timer = timers.find((x) => !x.cancelled)!
    timer.cancelled = true
    t += timer.ms
    timer.fn()
    await new Promise((r) => setTimeout(r, 0))
  }
  const live = () => timers.filter((x) => !x.cancelled)
  return { loop, states, timers, live, fire, connects: () => connects }
}

const kinds = (s: LinkState[]) => s.map((x) => x.kind)
const flush = () => new Promise((r) => setTimeout(r, 0))

test('временный обрыв: ожидание, попытка, снова в игре', async () => {
  const h = harness([{ ok: true }])
  h.loop.handleClose(1012)
  expect(h.states.at(-1)).toEqual({ kind: 'waiting', attempt: 0, retryAt: 2000 })
  await h.fire()
  expect(kinds(h.states)).toEqual(['waiting', 'connecting', 'online'])
  expect(h.connects()).toBe(1)
})

test('три неудачи подряд: задержки растут по номеру попытки, после успеха счётчик сброшен', async () => {
  const fail: ConnectResult = { ok: false, code: 1006, error: new Error('SOCKET_CLOSED:1006') }
  const h = harness([fail, fail, fail, { ok: true }])
  h.loop.handleClose(1006)
  for (let i = 0; i < 4; i++) await h.fire()
  expect(h.timers.map((x) => x.ms)).toEqual([1000, 2000, 4000, 8000])
  expect(h.states.at(-1)!.kind).toBe('online')
  h.loop.handleClose(1006)
  expect(h.live()[0].ms).toBe(1000)
})

test('upgrade не удался и /me → 401: экран входа, повторов нет', async () => {
  const h = harness([{ ok: false, code: 1006, error: new Error('SOCKET_CLOSED:1006') }], ['unauthenticated'])
  h.loop.handleClose(1006)
  await h.fire()
  expect(h.states.at(-1)!.kind).toBe('login')
  expect(h.live().length).toBe(0)
})

test('upgrade не удался, сеть недоступна: следующая попытка', async () => {
  const h = harness([{ ok: false, code: null, error: new Error('SNAPSHOT_TIMEOUT') }], ['network'])
  h.loop.handleClose(1006)
  await h.fire()
  expect(h.states.at(-1)).toMatchObject({ kind: 'waiting', attempt: 1 })
})

test('4009: без повторов; «Войти в мир» подключает заново', async () => {
  const h = harness([{ ok: true }])
  h.loop.handleClose(4009)
  expect(h.states.at(-1)!.kind).toBe('replaced')
  expect(h.live().length).toBe(0)
  expect(h.connects()).toBe(0)
  await h.loop.connectNow()
  expect(h.states.at(-1)!.kind).toBe('online')
})

test('4006 → обновить клиент, 1008 → стоп, 4001 → вход', () => {
  for (const [code, kind] of [
    [4006, 'update'],
    [1008, 'stopped'],
    [4001, 'login'],
  ] as const) {
    const h = harness([])
    h.loop.handleClose(code)
    expect(h.states.at(-1)!.kind).toBe(kind)
    expect(h.live().length).toBe(0)
  }
})

test('попытка закрылась кодом 4009 или 4006: повторы прекращаются', async () => {
  const h = harness([{ ok: false, code: 4009, error: new Error('SOCKET_CLOSED:4009') }])
  h.loop.handleClose(1012)
  await h.fire()
  expect(h.states.at(-1)!.kind).toBe('replaced')
  expect(h.live().length).toBe(0)
})

test('UNSUPPORTED_PROTOCOL при подключении — как 4006', async () => {
  const h = harness([{ ok: false, code: null, error: new Error('UNSUPPORTED_PROTOCOL') }])
  await h.loop.connectNow()
  expect(h.states.at(-1)!.kind).toBe('update')
})

test('выход во время ожидания: таймер отменён, попыток больше нет', async () => {
  const h = harness([{ ok: true }])
  h.loop.handleClose(1012)
  h.loop.stop()
  expect(h.live().length).toBe(0)
  await flush()
  expect(h.connects()).toBe(0)
})

test('выход во время попытки: её результат не меняет состояние', async () => {
  let release!: (r: ConnectResult) => void
  const states: LinkState[] = []
  const loop = new ReconnectLoop({
    connect: () => new Promise<ConnectResult>((r) => (release = r)),
    checkMe: async () => 'ok',
    schedule: () => () => {},
    now: () => 0,
    onState: (s) => states.push(s),
  })
  const p = loop.connectNow()
  loop.stop()
  release({ ok: true })
  await p
  expect(states.map((s) => s.kind)).toEqual(['connecting'])
})

test('«Повторить сейчас» во время ожидания: попытка сразу, старый таймер отменён', async () => {
  const h = harness([{ ok: true }])
  h.loop.handleClose(1012)
  h.loop.retryNow()
  await flush()
  expect(h.connects()).toBe(1)
  expect(h.live().length).toBe(0)
  expect(h.states.at(-1)!.kind).toBe('online')
})
