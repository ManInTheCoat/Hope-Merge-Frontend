/*
 * Раскладка частей человечка в системе тела: начало — на полу под центром, взгляд вперёд — вдоль −Z.
 * Чистая математика без Three.js: тело (позиция и yaw) складывается с этими преобразованиями в crowd.ts.
 */

export type PartName = 'head' | 'torso' | 'armL' | 'armR' | 'legL' | 'legR'
export type PartTransform = { part: PartName; position: [number, number, number]; rotation: [number, number, number] }

/** Размеры (м): общий рост ≈ 1,7. Руки и ноги вращаются вокруг верхнего конца (плечо, бедро). */
export const BODY = {
  legLength: 0.8,
  legX: 0.1,
  torsoHeight: 0.6,
  torsoWidth: 0.38,
  torsoDepth: 0.2,
  armLength: 0.6,
  armX: 0.25,
  headRadius: 0.12,
} as const

const HIP_Y = BODY.legLength
const SHOULDER_Y = HIP_Y + BODY.torsoHeight
const HEAD_Y = SHOULDER_Y + 0.05 + BODY.headRadius

/** `swing` — углы качания рук и ног (из `limbSwing`), `headYaw` — поворот головы относительно тела. */
export function partTransforms(swing: { arm: number; leg: number }, headYaw: number): PartTransform[] {
  return [
    { part: 'head', position: [0, HEAD_Y, 0], rotation: [0, headYaw, 0] },
    { part: 'torso', position: [0, HIP_Y + BODY.torsoHeight / 2, 0], rotation: [0, 0, 0] },
    { part: 'armL', position: [-BODY.armX, SHOULDER_Y, 0], rotation: [swing.arm, 0, 0] },
    { part: 'armR', position: [BODY.armX, SHOULDER_Y, 0], rotation: [0 - swing.arm, 0, 0] },
    { part: 'legL', position: [-BODY.legX, HIP_Y, 0], rotation: [swing.leg, 0, 0] },
    { part: 'legR', position: [BODY.legX, HIP_Y, 0], rotation: [0 - swing.leg, 0, 0] },
  ]
}
