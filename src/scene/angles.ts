/** Угол в диапазон [−π, π), как требует api.md. */
export function wrapAngle(a: number): number {
  const twoPi = Math.PI * 2
  return ((((a + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI
}
