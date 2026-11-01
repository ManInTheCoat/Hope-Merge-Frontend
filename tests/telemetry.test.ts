import { expect, test } from 'bun:test'
import { FpsMeter, METRICS_EVERY_MS, startTelemetry, type TelemetryEnv, type TelemetrySocket } from '../src/network/telemetry'
import { mockServer, tick } from './mockHarness'

function fakeEnv() {
  let t = 0
  let hidden = false
  let tickFn: (() => void) | null = null
  let visFn: (() => void) | null = null
  const env: TelemetryEnv = {
    setInterval: (fn) => ((tickFn = fn), 1),
    clearInterval: () => (tickFn = null),
    now: () => t,
    hidden: () => hidden,
    onVisibilityChange: (h) => ((visFn = h), () => (visFn = null)),
  }
  return {
    env,
    advance: (ms: number) => (t += ms),
    setHidden(v: boolean) {
      hidden = v
      visFn?.()
    },
    fire: () => tickFn?.(),
    active: () => tickFn !== null,
  }
}

function fakeSocket() {
  const sent: Array<{ type: string; payload: unknown }> = []
  let probe: ((p: { nonce: string }) => void) | null = null
  let close: ((code: number) => void) | null = null
  const socket: TelemetrySocket = {
    send: (type: string, payload: unknown) => sent.push({ type, payload }),
    on: (_t, h) => ((probe = h), () => (probe = null)),
    onClose: (h) => ((close = h), () => (close = null)),
  } as TelemetrySocket
  return { socket, sent, probe: (nonce: string) => probe?.({ nonce }), close: () => close?.(1006) }
}

test('FpsMeter: среднее за окно между отчётами', () => {
  const m = new FpsMeter()
  m.reset(0)
  for (let i = 0; i < 120; i++) m.frame()
  expect(m.take(2000)).toBe(60)
  for (let i = 0; i < 30; i++) m.frame()
  expect(m.take(4000)).toBe(15) // окно началось заново
  expect(m.take(4000)).toBeNull() // нулевая длина
})

test('FpsMeter: потолок 1000', () => {
  const m = new FpsMeter()
  m.reset(0)
  for (let i = 0; i < 100_000; i++) m.frame()
  expect(m.take(1000)).toBe(1000)
})

test('метрики раз в 2 с со средним FPS', () => {
  const f = fakeEnv()
  const s = fakeSocket()
  const meter = new FpsMeter()
  startTelemetry(s.socket, meter, f.env)
  for (let i = 0; i < 90; i++) meter.frame()
  f.advance(METRICS_EVERY_MS)
  f.fire()
  expect(s.sent).toEqual([{ type: 'client.metrics', payload: { fps: 45, visible: true } }])
})

test('скрытая вкладка: visible:false, fps:null сразу, без фиктивного 0', () => {
  const f = fakeEnv()
  const s = fakeSocket()
  startTelemetry(s.socket, new FpsMeter(), f.env)
  f.advance(500)
  f.setHidden(true)
  expect(s.sent).toEqual([{ type: 'client.metrics', payload: { fps: null, visible: false } }])
  f.advance(METRICS_EVERY_MS)
  f.fire()
  expect(s.sent.at(-1)).toEqual({ type: 'client.metrics', payload: { fps: null, visible: false } })
  expect(s.sent.every((m) => (m.payload as { fps: unknown }).fps !== 0)).toBe(true)
})

test('возврат во вкладку: время и кадры скрытого периода в среднее не входят', () => {
  const f = fakeEnv()
  const s = fakeSocket()
  const meter = new FpsMeter()
  startTelemetry(s.socket, meter, f.env)
  f.setHidden(true)
  f.advance(10_000)
  f.setHidden(false)
  for (let i = 0; i < 120; i++) meter.frame()
  f.advance(2000)
  f.fire()
  expect(s.sent.at(-1)).toEqual({ type: 'client.metrics', payload: { fps: 60, visible: true } })
})

test('probe → pong с тем же nonce, без request_id', () => {
  const f = fakeEnv()
  const s = fakeSocket()
  startTelemetry(s.socket, new FpsMeter(), f.env)
  s.probe('abc')
  expect(s.sent).toEqual([{ type: 'telemetry.pong', payload: { nonce: 'abc' } }])
})

test('закрытие сокета останавливает телеметрию', () => {
  const f = fakeEnv()
  const s = fakeSocket()
  startTelemetry(s.socket, new FpsMeter(), f.env)
  s.close()
  expect(f.active()).toBe(false)
})

// --- мок ---

const metrics = (visible: boolean, fps: number | null) => ({ type: 'client.metrics', payload: { fps, visible } })

test('мок: начальные значения null/stale, metrics до ready тоже принимаются', async () => {
  const h = await mockServer(null)
  await h.register()
  const c = await h.join()
  expect(h.server.clients()[0]).toMatchObject({ fps: null, ping_ms: null, visible: false, sampled_at: null, stale: true })
  c.ws.send(JSON.stringify(metrics(true, 58)))
  await tick()
  expect(h.server.clients()[0]).toMatchObject({ fps: 58, visible: true, stale: false })
  expect(h.server.clients()[0].sampled_at).not.toBeNull()
})

test('мок: некорректные metrics дают VALIDATION_ERROR и не меняют данные', async () => {
  const h = await mockServer(null)
  await h.register()
  const c = await h.join()
  c.ws.send(JSON.stringify(metrics(false, 30))) // hidden требует fps=null
  c.ws.send(JSON.stringify(metrics(true, 2000))) // выше 1000
  await tick()
  expect(c.inbox.filter((m) => m.type === 'error').length).toBe(2)
  expect(h.server.clients()[0].stale).toBe(true)
})

test('мок: FPS протухает через 6 с, видимость остаётся', async () => {
  const h = await mockServer(null)
  await h.register()
  const c = await h.join()
  c.ws.send(JSON.stringify(metrics(true, 60)))
  await tick()
  h.clock.advance(5999)
  expect(h.server.clients()[0]).toMatchObject({ fps: 60, stale: false })
  h.clock.advance(1)
  expect(h.server.clients()[0]).toMatchObject({ fps: null, stale: true })
})

test('мок: третье valid metrics за секунду отбрасывается молча', async () => {
  const h = await mockServer(null)
  await h.register()
  const c = await h.join()
  for (const fps of [10, 20, 30]) c.ws.send(JSON.stringify(metrics(true, fps)))
  await tick()
  expect(c.inbox.some((m) => m.type === 'error')).toBe(false)
  expect(h.server.clients()[0].fps).toBe(20)
})

test('мок: probe раз в период, RTT по часам сервера, чужой nonce игнорируется, потеря → null', async () => {
  const { createMockServer } = await import('../src/network/mock/server')
  const base = await mockServer(null)
  let t = 1000
  const server = createMockServer(base.world, null, { now: () => t, probeEveryMs: 15 })
  const res = await server.fetch('http://localhost/api/v1/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alice', display_name: 'alice', password: 'password1' }),
  })
  expect(res.status).toBe(201)
  const ws = new server.WebSocket('ws://localhost/api/v1/ws')
  const inbox: Array<{ type: string; payload: { nonce?: string } }> = []
  ws.onmessage = (e: MessageEvent) => inbox.push(JSON.parse(String(e.data)))
  let guard = 0
  while (!inbox.some((m) => m.type === 'telemetry.probe') && guard++ < 100) await tick()
  const probe = inbox.find((m) => m.type === 'telemetry.probe')!
  expect(server.clients()[0].ping_ms).toBeNull()

  ws.send(JSON.stringify({ type: 'telemetry.pong', payload: { nonce: 'чужой' } }))
  t += 42
  ws.send(JSON.stringify({ type: 'telemetry.pong', payload: { nonce: probe.payload.nonce } }))
  await tick()
  expect(server.clients()[0].ping_ms).toBe(42)

  // следующий probe остаётся без ответа 5 с → ping null
  const before = inbox.filter((m) => m.type === 'telemetry.probe').length
  guard = 0
  while (inbox.filter((m) => m.type === 'telemetry.probe').length === before && guard++ < 100) await tick()
  t += 5000
  expect(server.clients()[0].ping_ms).toBeNull()

  ws.close()
  expect(server.clients()).toEqual([]) // строка исчезает вместе с соединением
})
