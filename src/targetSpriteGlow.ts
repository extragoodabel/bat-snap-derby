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

/** Spacey bonus sprite — warm orange (distinct from wheel gold). */
export const SPACEY_ORANGE_GLOW_SHADOW = 'rgba(255, 118, 28, 0.82)'

/** Soft radial halo behind Spacey at screen anchor (does not rotate with peek). */
export function drawSpaceyOrangeRadialHalo(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  extentR: number,
  alphaMul: number
): void {
  const outerR = extentR * 2.25
  ctx.save()
  ctx.globalAlpha *= alphaMul
  const g = ctx.createRadialGradient(
    cx,
    cy,
    extentR * 0.06,
    cx,
    cy,
    outerR
  )
  g.addColorStop(0, 'rgba(255, 210, 140, 0)')
  g.addColorStop(0.42, 'rgba(255, 145, 55, 0.48)')
  g.addColorStop(0.78, 'rgba(255, 95, 25, 0.18)')
  g.addColorStop(1, 'rgba(255, 60, 0, 0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export function spaceySpriteShadowBlurPx(spriteMaxExtentPx: number): number {
  return Math.min(40, Math.max(14, spriteMaxExtentPx * 0.42))
}
