import type { Room } from '../contract'
import type { SundayRoomRuntime } from '../sunday'
import { NPC_MAX } from '../../npc/limits'

/** Высота шарнира головки лампы и наклон вниз по умолчанию (api-sunday.md §2). */
const LAMP_HEAD_Y = 1.1
const LAMP_BASE_TILT = Math.PI / 4
const LAMP_PITCH_MAX = Math.PI / 3
/** Во сколько метров перед картинами стоят места лампы. */
const SLOT_DISTANCE_M = 3.1

/**
 * Места лампы и её направление для зала мока. У настоящих залов 12×12 места фиксированы сервером ((3, 4) и (9, 4)),
 * а залы мока другой планировки: лампа ставится перед картинами и по умолчанию светит на них, под небольшим углом вверх
 * (иначе свет упирался бы в пол посреди зала). Без картин места отсчитываются от угла зала.
 */
function lampSetup(room: Room): { slots: Array<{ slot_id: 'a' | 'b'; position: { x: number; y: 0; z: number } }>; yaw: number; head_pitch: number } {
  const { min } = room.bounds
  const ex = room.exhibits
  if (!ex.length) {
    return {
      slots: [
        { slot_id: 'a', position: { x: min.x + 3, y: 0, z: min.z + 10 } },
        { slot_id: 'b', position: { x: min.x + 9, y: 0, z: min.z + 10 } },
      ],
      yaw: 0,
      head_pitch: 0,
    }
  }
  const ry = ex[0].rotation_y
  const n = { x: Math.sin(ry), z: Math.cos(ry) } // от картины в зал
  const t = { x: Math.cos(ry), z: -Math.sin(ry) } // вдоль стены
  const centre = { x: ex.reduce((a, e) => a + e.position.x, 0) / ex.length, z: ex.reduce((a, e) => a + e.position.z, 0) / ex.length }
  const along = ex.map((e) => (e.position.x - centre.x) * t.x + (e.position.z - centre.z) * t.z)
  const spread = Math.max(1, Math.max(...along.map(Math.abs)) - 1)
  const at = (side: number) => ({
    x: centre.x + n.x * SLOT_DISTANCE_M + t.x * spread * side,
    y: 0 as const,
    z: centre.z + n.z * SLOT_DISTANCE_M + t.z * spread * side,
  })
  const rise = Math.atan((ex[0].position.y - LAMP_HEAD_Y) / SLOT_DISTANCE_M)
  const head_pitch = Math.max(-LAMP_PITCH_MAX, Math.min(LAMP_PITCH_MAX, -rise - LAMP_BASE_TILT))
  return { slots: [{ slot_id: 'a', position: at(-1) }, { slot_id: 'b', position: at(1) }], yaw: ry, head_pitch }
}

/**
 * Runtime зала по умолчанию (api-sunday.md §2): оформление `#D9D2C3`, нейтральный свет, гиды на своих местах,
 * лампа на слоте a включена, стенд скрыт, 10 посетителей. Revision начинается с 1.
 *
 * Слоты отсчитываются от угла зала (`bounds.min`): у настоящих залов 12×12 это (3, 4) и (9, 4); у залов мока
 * другая планировка, поэтому слоты по Z сдвинуты в середину зала — подальше от гидов и экспонатов.
 */
export function defaultRuntime(room: Room): SundayRoomRuntime {
  const lampSpec = lampSetup(room)
  return {
    world_version: room.world_version,
    room_id: room.id,
    revision: 1,
    config: {
      accent_color: '#D9D2C3',
      lighting: 'neutral',
      guide_placements: room.guides.map((g) => ({
        guide_id: g.id,
        position: { x: g.position.x, y: 0, z: g.position.z },
        rotation_y: g.rotation_y,
      })),
      lamp_slots: lampSpec.slots,
      npc_count: NPC_MAX,
      installation_visible: false,
    },
    guides: room.guides.map((g) => ({
      guide_id: g.id,
      display_name: g.display_name,
      subtitle: g.subtitle,
      position: { x: g.position.x, y: 0, z: g.position.z },
      rotation_y: g.rotation_y,
    })),
    lamp: { object_id: 'lamp_01', slot_id: 'a', holder_user_id: null, yaw: lampSpec.yaw, head_pitch: lampSpec.head_pitch, on: true },
  }
}
