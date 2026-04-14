/**
 * Upright carnival wheel: vertical axis stays vertical on screen, horizontal
 * axis foreshortened (yaw / plan view). No twist, no pitch, no skew.
 */
export const DISC_SX = 0.64

/**
 * Rim point in screen space. Local circle (x_local, y_local) →
 * x_screen = cx + sx * x_local, y_screen = cy + y_local
 */
export function ringScreenPoint(
  cx: number,
  cy: number,
  sx: number,
  R: number,
  angle: number
): { x: number; y: number } {
  const xl = R * Math.cos(angle)
  const yl = R * Math.sin(angle)
  return {
    x: cx + sx * xl,
    y: cy + yl,
  }
}
