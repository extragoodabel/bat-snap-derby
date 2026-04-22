/**
 * Golden outer glow shared by carnival-wheel targets (numeric pegs + moose/salmon) and
 * bonus floating sprites (see `cloudSprites.ts`).
 */

/** Canvas `shadowColor` for sprite silhouettes — warm gold, readable on field. */
export const TARGET_GOLD_GLOW_SHADOW = 'rgba(255, 198, 72, 0.82)'

/** Radial halo behind filled disc pegs (ring 0 & 2). */
export function drawDiscPegGoldenOuterGlow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  pegR: number,
  alphaMul: number
): void {
  const outerR = pegR * 2.5
  ctx.save()
  ctx.globalAlpha *= alphaMul
  const g = ctx.createRadialGradient(
    cx,
    cy,
    pegR * 0.12,
    cx,
    cy,
    outerR
  )
  g.addColorStop(0, 'rgba(255, 235, 190, 0)')
  g.addColorStop(0.42, 'rgba(255, 205, 95, 0.48)')
  g.addColorStop(0.78, 'rgba(255, 170, 55, 0.16)')
  g.addColorStop(1, 'rgba(255, 145, 35, 0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** Soft halo at the sign anchor before drawing moose/salmon art. */
export function drawMiddleRingSignGoldenHalo(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  signRadiusPx: number,
  alphaMul: number
): void {
  const outerR = signRadiusPx * 2.35
  ctx.save()
  ctx.globalAlpha *= alphaMul
  const g = ctx.createRadialGradient(
    cx,
    cy,
    signRadiusPx * 0.08,
    cx,
    cy,
    outerR
  )
  g.addColorStop(0, 'rgba(255, 240, 200, 0)')
  g.addColorStop(0.48, 'rgba(255, 210, 100, 0.42)')
  g.addColorStop(0.88, 'rgba(255, 175, 55, 0.1)')
  g.addColorStop(1, 'rgba(255, 150, 40, 0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** `shadowBlur` for `drawImage` targets — scales with on-screen sign/trigger size. */
export function discTargetImageShadowBlurPx(refRadiusPx: number): number {
  return Math.min(34, Math.max(11, refRadiusPx * 1.22))
}

/** Spacey: same gold family as wheel targets; ~50% softer than full peg shadow alpha. */
export const SPACEY_GOLD_GLOW_SHADOW = 'rgba(255, 198, 72, 0.41)'

const SPACEY_HALO_STRENGTH = 0.5
/** `signRadiusPx` fraction of sprite extent — keeps radial ~½ the old Spacey halo size. */
const SPACEY_HALO_EXTENT_FR = 0.11

/**
 * Outer golden halo behind Spacey (same gradient recipe as middle-ring signs), calmed by
 * {@link SPACEY_HALO_STRENGTH} on size/intensity vs a full wheel peg halo.
 */
export function drawSpaceyGoldenOuterGlow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  spriteMaxExtentPx: number,
  alphaMul: number
): void {
  drawMiddleRingSignGoldenHalo(
    ctx,
    cx,
    cy,
    spriteMaxExtentPx * SPACEY_HALO_EXTENT_FR,
    alphaMul * SPACEY_HALO_STRENGTH
  )
}

/** Canvas shadow blur for Spacey — matches disc sprite glow curve at 50% strength/size. */
export function spaceyGoldenShadowBlurPx(spriteMaxExtentPx: number): number {
  return discTargetImageShadowBlurPx(spriteMaxExtentPx * 0.35) * SPACEY_HALO_STRENGTH
}
