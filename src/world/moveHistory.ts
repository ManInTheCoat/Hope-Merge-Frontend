import type { Vec2 } from '../scene/collision'

/** Расхождение больше этого значит, что сервер отклонил шаг и оставил прежнюю позицию. */
const REJECT_TOLERANCE_M = 0.01

/**
 * Отправленные `player.move` по `seq`. По `players.state` (ack_seq + позиция) находим отклонённый
 * сервером шаг и возвращаем игрока туда, где его видит сервер (api.md: «клиент корректирует себя»).
 * Иначе после одного отклонения позиции расходятся и дальше сервер отклоняет всё подряд.
 */
export class MoveHistory {
  private sent = new Map<number, Vec2>()

  get size(): number {
    return this.sent.size
  }

  record(seq: number, pos: Vec2): void {
    this.sent.set(seq, { x: pos.x, z: pos.z })
  }

  /** Позиция для коррекции, если шаг `ackSeq` отклонён; иначе null. */
  reconcile(ackSeq: number, serverPos: Vec2): Vec2 | null {
    const sent = this.sent.get(ackSeq)
    if (!sent) return null
    for (const seq of this.sent.keys()) if (seq <= ackSeq) this.sent.delete(seq)
    if (Math.hypot(sent.x - serverPos.x, sent.z - serverPos.z) <= REJECT_TOLERANCE_M) return null
    this.sent.clear()
    return { x: serverPos.x, z: serverPos.z }
  }

  clear(): void {
    this.sent.clear()
  }
}
