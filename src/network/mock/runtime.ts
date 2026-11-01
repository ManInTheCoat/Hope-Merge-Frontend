import type { Room } from '../contract'
import type { SundayRoomRuntime } from '../sunday'

/**
 * Runtime зала по умолчанию (api-sunday.md §2): оформление `#D9D2C3`, нейтральный свет, гиды на своих местах,
 * лампа на слоте a включена, стенд скрыт, 40 посетителей. Revision начинается с 1.
 *
 * Слоты отсчитываются от угла зала (`bounds.min`): у настоящих залов 12×12 это (3, 4) и (9, 4); у залов мока
 * другая планировка, поэтому слоты по Z сдвинуты в середину зала — подальше от гидов и экспонатов.
 */
export function defaultRuntime(room: Room): SundayRoomRuntime {
  const { min } = room.bounds
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
      lamp_slots: [
        { slot_id: 'a', position: { x: min.x + 3, y: 0, z: min.z + 10 } },
        { slot_id: 'b', position: { x: min.x + 9, y: 0, z: min.z + 10 } },
      ],
      npc_count: 40,
      installation_visible: false,
    },
    guides: room.guides.map((g) => ({
      guide_id: g.id,
      display_name: g.display_name,
      subtitle: g.subtitle,
      position: { x: g.position.x, y: 0, z: g.position.z },
      rotation_y: g.rotation_y,
    })),
    lamp: { object_id: 'lamp_01', slot_id: 'a', holder_user_id: null, yaw: 0, head_pitch: 0, on: true },
  }
}
