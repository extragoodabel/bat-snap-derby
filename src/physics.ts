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
