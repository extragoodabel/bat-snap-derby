export type Vec2 = { x: number; y: number }

export type Ball = {
  x: number
  y: number
  vx: number
  vy: number
  r: number
}

export function integrateBall(b: Ball, gravity: number, dt: number): void {
  b.vy += gravity * dt
  b.x += b.vx * dt
  b.y += b.vy * dt
}

export function circlesOverlap(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number
): boolean {
  const dx = bx - ax
  const dy = by - ay
  const rr = ar + br
  return dx * dx + dy * dy <= rr * rr
}

/**
 * Perpendicular distance from P to the infinite ray origin O + s * U, and signed
 * along-ray coordinate (U must be unit). along > 0 means P is ahead of O in flight direction.
 */
export function distPointToUnitRay(
  px: number,
  py: number,
  ox: number,
  oy: number,
  ux: number,
  uy: number
): { perp: number; along: number } {
  const wx = px - ox
  const wy = py - oy
  const along = wx * ux + wy * uy
  const perpSq = wx * wx + wy * wy - along * along
  return { perp: Math.sqrt(Math.max(0, perpSq)), along }
}

/**
 * Smallest t ∈ [0, 1] where segment P0→P1 enters the circle (center, radius).
 * t=0 at P0, t=1 at P1. Returns null if the segment never hits the disc (endpoints outside).
 * If P0 is already inside, returns 0.
 */
export function segmentCircleEarliestHit(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  radius: number
): number | null {
  const dx = x1 - x0
  const dy = y1 - y0
  const fx = x0 - cx
  const fy = y0 - cy
  const rr = radius * radius
  const inside0 = fx * fx + fy * fy <= rr
  if (inside0) return 0

  const a = dx * dx + dy * dy
  if (a < 1e-14) return null

  const b = 2 * (fx * dx + fy * dy)
  const c = fx * fx + fy * fy - rr
  const disc = b * b - 4 * a * c
  if (disc < 0) return null

  const s = Math.sqrt(disc)
  const t0 = (-b - s) / (2 * a)
  const t1 = (-b + s) / (2 * a)
  let best: number | null = null
  if (t0 >= 0 && t0 <= 1) best = t0
  if (t1 >= 0 && t1 <= 1 && (best == null || t1 < best)) best = t1
  return best
}

export function batTip(pivot: Vec2, length: number, angle: number): Vec2 {
  return {
    x: pivot.x + Math.cos(angle) * length,
    y: pivot.y + Math.sin(angle) * length,
  }
}

/** Point along bat from pivot (t=0) toward tip (t=1). */
export function batPointAlong(
  pivot: Vec2,
  length: number,
  angle: number,
  t: number
): Vec2 {
  const u = Math.max(0, Math.min(1, t))
  return {
    x: pivot.x + Math.cos(angle) * length * u,
    y: pivot.y + Math.sin(angle) * length * u,
  }
}

/** Closest-point parameter t ∈ [0,1] on pivot→tip segment to screen point P. */
export function closestTOnBat(
  px: number,
  py: number,
  pivot: Vec2,
  length: number,
  angle: number
): number {
  const tip = batTip(pivot, length, angle)
  const abx = tip.x - pivot.x
  const aby = tip.y - pivot.y
  const apx = px - pivot.x
  const apy = py - pivot.y
  const ab2 = abx * abx + aby * aby
  if (ab2 < 1e-10) return 0
  return Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2))
}

/** Squared distance from point P to segment AB. */
export function distSqPointSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const abx = bx - ax
  const aby = by - ay
  const apx = px - ax
  const apy = py - ay
  const ab2 = abx * abx + aby * aby
  if (ab2 < 1e-10) {
    const dx = px - ax
    const dy = py - ay
    return dx * dx + dy * dy
  }
  let t = (apx * abx + apy * aby) / ab2
  t = Math.max(0, Math.min(1, t))
  const qx = ax + t * abx
  const qy = ay + t * aby
  const dx = px - qx
  const dy = py - qy
  return dx * dx + dy * dy
}
