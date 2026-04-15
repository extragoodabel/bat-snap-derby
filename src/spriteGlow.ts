/**
 * Layered hero lighting: atmospheric bloom (A), silhouette halos (B), specular shimmer (C).
 * Composition-tuned: large footprint behind torso/bat, additive halos, few slow glints.
 */
import type { SpriteLayout } from './gameSprites'

/** Master strength for atmospheric plumes. */
export const GLOW_BACK_OPACITY = 0.36
export const GLOW_BACK_BLUR = 2.25

export const GLOW_BACK_DRIFT_FR = 0.018
export const GLOW_BACK_DRIFT_SPEED = 0.72
/** Veil / curtain shear rate (rad/s); keep readable motion in a few seconds. */
export const GLOW_AURORA_FLOW = 0.95
/**
 * Slower aurora phase (rad/s). ~0.55 ≈ ~11s wave — still “slow” but visibly alive.
 */
export const AURORA_SLOW_SHIMMER = 0.55

/** Silhouette bloom (`lighter`). */
export const GLOW_HALO_OPACITY = 0.52
export const GLOW_HALO_BLUR = 9.5
export const GLOW_STATUE_HALO_EXTRA = 1.22

export const GLOW_PULSE_SPEED = (Math.PI * 2) / 3.4
export const GLOW_PULSE_AMOUNT = 0.11

export const GLOW_SWING_HALO_BOOST = 0.08

/** Specular glints on statue; speed tuned so travel + breathe read within ~2–5s. */
export const SHIMMER_INTENSITY = 0.56
export const SHIMMER_SPEED = 0.72

const STATUE_HALO_WARM = '#fff6eb'
const BAT_HALO_WARM = '#f5e0c4'
const AURORA_TEAL = 'rgba(115, 225, 208,'
const AURORA_MINT = 'rgba(160, 235, 220,'
const AURORA_DEEP = 'rgba(90, 195, 185,'
const AURORA_GLOW = 'rgba(200, 255, 245,'
const AURORA_SKY = 'rgba(105, 215, 200,'

let scratchEl: HTMLCanvasElement | null = null
function scratchCtx(w: number, h: number): {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
} {
  if (!scratchEl) scratchEl = document.createElement('canvas')
  const c = scratchEl
  const needW = Math.ceil(w)
  const needH = Math.ceil(h)
  if (c.width < needW) c.width = needW
  if (c.height < needH) c.height = needH
  const ctx = c.getContext('2d', { willReadFrequently: false })!
  return { canvas: c, ctx }
}

function pulseFactor(simTime: number): number {
  return 1 + GLOW_PULSE_AMOUNT * Math.sin(GLOW_PULSE_SPEED * simTime)
}

function swingHaloBoost(
  phase: 'idle' | 'charging' | 'swing' | 'recovery',
  omega: number
): number {
  let b = 0
  if (phase === 'swing' || phase === 'recovery') {
    b += GLOW_SWING_HALO_BOOST * 0.55
  }
  b += GLOW_SWING_HALO_BOOST * 0.5 * Math.min(1, Math.abs(omega) / 16)
  return 1 + b
}

/**
 * LAYER A — warm mass + slow aurora curtains / ribbons behind the statue (additive teal).
 */
export function drawAtmosphericBackGlow(
  ctx: CanvasRenderingContext2D,
  layout: SpriteLayout,
  w: number,
  h: number,
  simTime: number,
  phase: 'idle' | 'charging' | 'swing' | 'recovery',
  omega: number
): void {
  const pulse = pulseFactor(simTime)
  const swing = swingHaloBoost(phase, omega)
  const base = GLOW_BACK_OPACITY * pulse * Math.min(1.1, swing)

  const { statueX, statueY, statueW, statueH, pivot, batLen } = layout
  const m = Math.min(w, h)
  const drift =
    GLOW_BACK_DRIFT_FR *
    m *
    Math.sin(simTime * GLOW_BACK_DRIFT_SPEED * Math.PI * 2)
  const driftX =
    GLOW_BACK_DRIFT_FR *
    m *
    0.55 *
    Math.cos(simTime * GLOW_BACK_DRIFT_SPEED * 0.68 * Math.PI * 2)
  const flow = simTime * GLOW_AURORA_FLOW
  const flow2 = simTime * (GLOW_AURORA_FLOW * 0.71)
  const slow = simTime * AURORA_SLOW_SHIMMER
  const slow2 = simTime * (AURORA_SLOW_SHIMMER * 0.67)
  const slow3 = simTime * (AURORA_SLOW_SHIMMER * 0.43)

  const swayX =
    statueW * 0.055 * Math.sin(flow * 1.03) +
    statueW * 0.07 * Math.sin(slow * 0.85)
  const swayY =
    statueH * 0.04 * Math.cos(flow * 0.89) +
    statueH * 0.05 * Math.cos(slow2 * 0.92 + 0.4)
  const swayX2 =
    statueW * 0.045 * Math.sin(flow2 * 1.17 + 1.2) +
    statueW * 0.05 * Math.sin(slow3 * 1.1)
  const swayY2 =
    statueH * 0.035 * Math.cos(flow2 * 0.94 + 0.6) +
    statueH * 0.045 * Math.sin(slow * 0.78)

  /** Torso / upper-body anchor — lower on the figure than the old single blob. */
  const torsoCx = statueX + statueW * 0.48 + driftX * 0.55 + swayX
  const torsoCy = statueY + statueH * 0.5 - drift * 0.35 + swayY

  const heroSpan = Math.max(statueW, statueH, batLen * 1.2)
  const rMain = Math.max(m * 0.36, heroSpan * 0.62)

  ctx.save()
  if (GLOW_BACK_BLUR > 0.5) {
    ctx.filter = `blur(${GLOW_BACK_BLUR}px)`
  }

  const gMain = ctx.createRadialGradient(
    torsoCx,
    torsoCy,
    0,
    torsoCx,
    torsoCy,
    rMain * 1.15
  )
  const warmPulse =
    0.7 + 0.18 * Math.sin(flow * 0.62) + 0.16 * Math.sin(slow * 0.55)
  gMain.addColorStop(0, `rgba(255, 242, 222, ${base * 0.95 * warmPulse})`)
  gMain.addColorStop(0.28, `rgba(255, 218, 182, ${base * 0.48 * warmPulse})`)
  gMain.addColorStop(0.58, `rgba(255, 198, 155, ${base * 0.2 * warmPulse})`)
  gMain.addColorStop(0.82, `rgba(255, 185, 135, ${base * 0.06 * warmPulse})`)
  gMain.addColorStop(1, 'rgba(255,175,120,0)')
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = gMain
  ctx.beginPath()
  ctx.ellipse(
    torsoCx,
    torsoCy,
    rMain * 1.02,
    rMain * 1.12,
    -0.06,
    0,
    Math.PI * 2
  )
  ctx.fill()

  const colW = statueW * 0.72
  const colH = statueH * 1.08
  const tcx =
    statueX +
    statueW * 0.46 +
    driftX * 0.45 +
    statueW * 0.035 * Math.sin(slow2 * 0.88)
  const tcy =
    statueY +
    statueH * 0.52 -
    drift * 0.4 +
    statueH * 0.04 * Math.cos(slow * 0.72)
  const gCol = ctx.createRadialGradient(
    tcx,
    tcy,
    0,
    tcx,
    tcy,
    Math.max(colW, colH) * 0.58
  )
  const colBreath = 0.78 + 0.22 * Math.sin(slow * 0.48)
  gCol.addColorStop(0, `rgba(255, 234, 210, ${base * 0.55 * colBreath})`)
  gCol.addColorStop(0.4, `rgba(255, 208, 172, ${base * 0.24 * colBreath})`)
  gCol.addColorStop(0.75, `rgba(255, 188, 148, ${base * 0.08 * colBreath})`)
  gCol.addColorStop(1, 'rgba(255,170,120,0)')
  ctx.fillStyle = gCol
  ctx.beginPath()
  ctx.ellipse(tcx, tcy, colW * 0.5, colH * 0.52, -0.04, 0, Math.PI * 2)
  ctx.fill()

  /** Upward plume behind typical swing arc (above pivot, biased toward bat plane). */
  const arcCx =
    pivot.x -
    batLen * 0.12 +
    driftX * 0.25 +
    batLen * 0.04 * Math.sin(flow * 0.91)
  const arcCy =
    pivot.y - batLen * 0.62 - drift * 0.25 + batLen * 0.03 * Math.cos(flow2)
  const arcRx = batLen * 1.05
  const arcRy = batLen * 1.35
  const gArc = ctx.createRadialGradient(arcCx, arcCy, 0, arcCx, arcCy, arcRy)
  gArc.addColorStop(0, `rgba(255, 230, 200, ${base * 0.42})`)
  gArc.addColorStop(0.45, `rgba(255, 205, 168, ${base * 0.18})`)
  gArc.addColorStop(1, 'rgba(255,175,120,0)')
  ctx.fillStyle = gArc
  ctx.beginPath()
  ctx.ellipse(arcCx, arcCy, arcRx, arcRy, 0.22, 0, Math.PI * 2)
  ctx.fill()

  /** Teal accent: small, torso-centered so it does not wash the gallery. */
  const tealR = Math.min(m * 0.24, heroSpan * 0.45)
  const gTeal = ctx.createRadialGradient(
    torsoCx - statueW * 0.06,
    torsoCy - statueH * 0.08,
    0,
    torsoCx,
    torsoCy,
    tealR
  )
  const tealPulse =
    0.52 +
    0.3 * Math.sin(slow * 0.95) +
    0.22 * Math.sin(flow * 1.1 + slow * 0.3)
  gTeal.addColorStop(
    0,
    `${AURORA_TEAL}${(base * 0.55 * tealPulse).toFixed(3)})`
  )
  gTeal.addColorStop(
    0.5,
    `${AURORA_TEAL}${(base * 0.22 * tealPulse).toFixed(3)})`
  )
  gTeal.addColorStop(1, 'rgba(90,175,165,0)')
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = gTeal
  ctx.beginPath()
  ctx.ellipse(torsoCx, torsoCy, tealR * 0.95, tealR * 1.05, 0.05, 0, Math.PI * 2)
  ctx.fill()

  /** Drifting aurora veils (torso-hugging, slow). */
  const v1x = torsoCx + swayX2 + statueW * 0.12 * Math.sin(flow * 0.88)
  const v1y = torsoCy + swayY2 - statueH * 0.06
  const rv1 = tealR * 0.72
  const gv1 = ctx.createRadialGradient(v1x, v1y, 0, v1x, v1y, rv1)
  gv1.addColorStop(0, `${AURORA_MINT}${(base * 0.32 * (0.7 + 0.3 * Math.sin(flow))).toFixed(3)})`)
  gv1.addColorStop(0.55, `${AURORA_DEEP}${(base * 0.12).toFixed(3)})`)
  gv1.addColorStop(1, 'rgba(80,170,160,0)')
  ctx.fillStyle = gv1
  ctx.beginPath()
  ctx.ellipse(v1x, v1y, rv1 * 1.05, rv1 * 0.88, flow * 0.08, 0, Math.PI * 2)
  ctx.fill()

  const v2x = torsoCx - statueW * 0.08 * Math.cos(flow2 * 0.95)
  const v2y = torsoCy + statueH * 0.1 + statueH * 0.04 * Math.sin(flow * 0.73)
  const rv2 = tealR * 0.55
  const gv2 = ctx.createRadialGradient(v2x, v2y, 0, v2x, v2y, rv2)
  gv2.addColorStop(0, `${AURORA_TEAL}${(base * 0.26 * (0.65 + 0.35 * Math.cos(flow2))).toFixed(3)})`)
  gv2.addColorStop(1, 'rgba(100,185,175,0)')
  ctx.fillStyle = gv2
  ctx.beginPath()
  ctx.ellipse(v2x, v2y, rv2, rv2 * 0.92, -flow * 0.06, 0, Math.PI * 2)
  ctx.fill()

  /**
   * Tall “curtain” of aurora behind the statue: linear gradient shears slowly
   * (reads as light rippling through haze).
   */
  const curtainCx = statueX + statueW * 0.42 + statueW * 0.06 * Math.sin(slow * 0.62)
  const curtainCy = statueY + statueH * 0.5 + statueH * 0.03 * Math.cos(slow2 * 0.55)
  const ang = slow * 0.035 + 0.12
  const crx = statueW * 0.62
  const cry = statueH * 0.72
  const gx0 = curtainCx - Math.cos(ang) * crx - Math.sin(ang) * cry * 0.15
  const gy0 = curtainCy - Math.sin(ang) * crx + Math.cos(ang) * cry * 0.15
  const gx1 = curtainCx + Math.cos(ang) * crx * 0.85 + Math.sin(ang) * cry * 0.2
  const gy1 = curtainCy + Math.sin(ang) * crx * 0.85 - Math.cos(ang) * cry * 0.2
  const curtain = ctx.createLinearGradient(gx0, gy0, gx1, gy1)
  const curA =
    base *
    (0.2 + 0.2 * Math.sin(slow * 0.71) + 0.14 * Math.cos(slow3 * 0.89))
  curtain.addColorStop(0, 'rgba(70, 185, 175, 0)')
  curtain.addColorStop(
    0.28 + 0.06 * Math.sin(slow2),
    `${AURORA_SKY}${(curA * 0.55).toFixed(3)})`
  )
  curtain.addColorStop(
    0.52 + 0.05 * Math.cos(slow * 0.63),
    `${AURORA_GLOW}${(curA * 0.42).toFixed(3)})`
  )
  curtain.addColorStop(
    0.78,
    `${AURORA_MINT}${(curA * 0.28).toFixed(3)})`
  )
  curtain.addColorStop(1, 'rgba(140, 220, 200, 0)')
  ctx.fillStyle = curtain
  ctx.beginPath()
  ctx.ellipse(curtainCx, curtainCy, crx, cry, ang, 0, Math.PI * 2)
  ctx.fill()

  /** Second slow ribbon — offset phase so motion never feels loop-locked. */
  const ribCx =
    statueX + statueW * 0.5 + statueW * 0.08 * Math.cos(slow3 * 0.74 + 1.1)
  const ribCy =
    statueY + statueH * 0.44 + statueH * 0.06 * Math.sin(slow * 0.51)
  const ribR = Math.max(statueW, statueH) * 0.38
  const gRib = ctx.createRadialGradient(ribCx, ribCy, 0, ribCx, ribCy, ribR)
  const ribA =
    base *
    (0.16 + 0.22 * Math.sin(slow2 * 0.81) + 0.16 * Math.sin(slow3 * 1.05))
  gRib.addColorStop(0, `${AURORA_TEAL}${(ribA * 0.5).toFixed(3)})`)
  gRib.addColorStop(0.45, `${AURORA_DEEP}${(ribA * 0.22).toFixed(3)})`)
  gRib.addColorStop(1, 'rgba(85, 175, 165, 0)')
  ctx.fillStyle = gRib
  ctx.beginPath()
  ctx.ellipse(
    ribCx,
    ribCy,
    ribR * 1.05,
    ribR * 0.72,
    slow * 0.05 - 0.2,
    0,
    Math.PI * 2
  )
  ctx.fill()

  /** Light bat-side warm wash (kept modest so hero stays the focus). */
  const px = pivot.x + driftX * 0.35
  const pyPlume = pivot.y - drift * 0.28
  const gBat = ctx.createRadialGradient(
    px,
    pyPlume + batLen * 0.18,
    0,
    px,
    pyPlume,
    batLen * 1.15
  )
  gBat.addColorStop(0, `rgba(255, 222, 188, ${base * 0.28})`)
  gBat.addColorStop(0.55, `rgba(255, 198, 158, ${base * 0.1})`)
  gBat.addColorStop(1, 'rgba(255,175,120,0)')
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = gBat
  ctx.beginPath()
  ctx.ellipse(
    px,
    pyPlume + batLen * 0.06,
    batLen * 0.82,
    batLen * 1.0,
    0.12,
    0,
    Math.PI * 2
  )
  ctx.fill()

  ctx.restore()
}

export function drawStatueSilhouetteHalo(
  ctx: CanvasRenderingContext2D,
  statueImg: HTMLImageElement,
  layout: SpriteLayout,
  simTime: number,
  phase: 'idle' | 'charging' | 'swing' | 'recovery',
  omega: number
): void {
  const {
    statueX,
    statueY,
    statueW,
    statueH,
    statueSrcX,
    statueSrcY,
    statueSrcW,
    statueSrcH,
  } = layout

  const pad = GLOW_HALO_BLUR * 2 + 12
  const W = Math.ceil(statueW + pad)
  const H = Math.ceil(statueH + pad)
  const ox = (pad / 2) | 0
  const oy = (pad / 2) | 0

  const { canvas, ctx: gx } = scratchCtx(W, H)
  gx.clearRect(0, 0, W, H)
  gx.fillStyle = STATUE_HALO_WARM
  gx.fillRect(0, 0, W, H)
  gx.globalCompositeOperation = 'destination-in'
  gx.drawImage(
    statueImg,
    statueSrcX,
    statueSrcY,
    statueSrcW,
    statueSrcH,
    ox,
    oy,
    statueW,
    statueH
  )
  gx.globalCompositeOperation = 'source-over'

  const pulse = pulseFactor(simTime)
  const boost = swingHaloBoost(phase, omega)
  const alphaBase = Math.min(
    1,
    GLOW_HALO_OPACITY * GLOW_STATUE_HALO_EXTRA * pulse * boost
  )
  /** Wider alpha swing + fast micro-twinkle so halos don’t read as a frozen bloom. */
  const auroraShimmer =
    0.68 +
    0.2 * Math.sin(simTime * GLOW_AURORA_FLOW * 1.2) +
    0.24 * Math.sin(simTime * AURORA_SLOW_SHIMMER * 0.9) +
    0.06 * Math.sin(simTime * 3.15 + 0.7)

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.filter = `blur(${GLOW_HALO_BLUR * 1.28}px)`
  ctx.globalAlpha = Math.min(1, alphaBase * 0.48 * auroraShimmer)
  ctx.drawImage(canvas, 0, 0, W, H, statueX - ox, statueY - oy, W, H)
  ctx.filter = `blur(${GLOW_HALO_BLUR * 0.48}px)`
  ctx.globalAlpha = Math.min(1, alphaBase * 0.88 * auroraShimmer)
  ctx.drawImage(canvas, 0, 0, W, H, statueX - ox, statueY - oy, W, H)
  ctx.filter = `blur(${GLOW_HALO_BLUR * 0.22}px)`
  ctx.globalAlpha = Math.min(1, alphaBase * 0.42 * auroraShimmer)
  ctx.drawImage(canvas, 0, 0, W, H, statueX - ox, statueY - oy, W, H)
  ctx.restore()

  gx.clearRect(0, 0, W, H)
  gx.fillStyle = 'rgba(150, 235, 218, 1)'
  gx.fillRect(0, 0, W, H)
  gx.globalCompositeOperation = 'destination-in'
  gx.drawImage(
    statueImg,
    statueSrcX,
    statueSrcY,
    statueSrcW,
    statueSrcH,
    ox,
    oy,
    statueW,
    statueH
  )
  gx.globalCompositeOperation = 'source-over'

  const tealBreath =
    0.38 +
    0.62 *
      (0.5 + 0.5 * Math.sin(simTime * AURORA_SLOW_SHIMMER * 1.35)) +
    0.12 * Math.sin(simTime * GLOW_AURORA_FLOW * 0.95)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.filter = `blur(${GLOW_HALO_BLUR * 0.95}px)`
  ctx.globalAlpha = Math.min(1, alphaBase * 0.2 * tealBreath)
  ctx.drawImage(canvas, 0, 0, W, H, statueX - ox, statueY - oy, W, H)
  ctx.filter = `blur(${GLOW_HALO_BLUR * 0.38}px)`
  ctx.globalAlpha = Math.min(1, alphaBase * 0.14 * (1.15 - tealBreath * 0.35))
  ctx.drawImage(canvas, 0, 0, W, H, statueX - ox, statueY - oy, W, H)
  ctx.restore()
}

export function drawBatSilhouetteHalo(
  ctx: CanvasRenderingContext2D,
  batImg: HTMLImageElement,
  layout: SpriteLayout,
  thetaRad: number,
  simTime: number,
  phase: 'idle' | 'charging' | 'swing' | 'recovery',
  omega: number
): void {
  const {
    pivot,
    batLen,
    batRotDeltaRad,
    batKnobXPxNat,
    batKnobYPxNat,
    batSrcX,
    batSrcY,
    batSrcW,
    batSrcH,
    batUniformScale,
  } = layout

  const phi = thetaRad + batRotDeltaRad
  const knobLocalX = batKnobXPxNat - batSrcX
  const knobLocalY = batKnobYPxNat - batSrcY
  const sw = Math.max(1, batSrcW)
  const sh = Math.max(1, batSrcH)
  const dw = sw * batUniformScale
  const dh = sh * batUniformScale
  const dxDest = -(knobLocalX / sw) * dw
  const dyDest = -(knobLocalY / sh) * dh

  const pad = GLOW_HALO_BLUR * 2 + 14
  const S = Math.ceil(Math.max(dw, dh) + pad)

  const { canvas, ctx: gx } = scratchCtx(S, S)
  gx.clearRect(0, 0, S, S)
  gx.fillStyle = BAT_HALO_WARM
  gx.fillRect(0, 0, S, S)
  gx.globalCompositeOperation = 'destination-in'
  gx.save()
  gx.translate(S / 2, S / 2)
  gx.rotate(phi)
  gx.drawImage(batImg, batSrcX, batSrcY, sw, sh, dxDest, dyDest, dw, dh)
  gx.restore()
  gx.globalCompositeOperation = 'source-over'

  const pulse = pulseFactor(simTime)
  const boost = swingHaloBoost(phase, omega)
  const alpha = Math.min(0.88, GLOW_HALO_OPACITY * 0.9 * pulse * boost)
  const batShimmer =
    0.78 + 0.2 * Math.sin(simTime * GLOW_AURORA_FLOW * 1.5) + 0.06 * Math.sin(simTime * 2.8)

  /** Clip to bat shaft only — kills square-canvas corner blur artifacts. */
  const clipCx = pivot.x + Math.cos(phi) * batLen * 0.42
  const clipCy = pivot.y + Math.sin(phi) * batLen * 0.42
  const clipRx = batLen * 0.5
  const clipRy = batLen * 0.13

  const dx = pivot.x - S / 2
  const dy = pivot.y - S / 2

  ctx.save()
  ctx.beginPath()
  ctx.ellipse(clipCx, clipCy, clipRx, clipRy, phi, 0, Math.PI * 2)
  ctx.clip()
  ctx.filter = `blur(${GLOW_HALO_BLUR * 0.82}px)`
  ctx.globalAlpha = alpha * 0.72 * batShimmer
  ctx.globalCompositeOperation = 'lighter'
  ctx.drawImage(canvas, 0, 0, S, S, dx, dy, S, S)
  ctx.filter = `blur(${GLOW_HALO_BLUR * 0.34}px)`
  ctx.globalAlpha = alpha * 0.55 * batShimmer
  ctx.drawImage(canvas, 0, 0, S, S, dx, dy, S, S)
  ctx.restore()
}

/**
 * LAYER C — slow glints on statue (helmet, shoulder, hand). Bat uses halo only.
 */
export function drawHeroShimmer(
  ctx: CanvasRenderingContext2D,
  layout: SpriteLayout,
  simTime: number,
  _thetaRad: number,
  phase: 'idle' | 'charging' | 'swing' | 'recovery',
  omega: number
): void {
  const t = simTime * SHIMMER_SPEED
  const {
    statueX,
    statueY,
    statueW,
    statueH,
    statueHandInVisX,
    statueHandInVisY,
    statueUniformScale,
  } = layout
  const drift = 0.06 * Math.sin(t * 1.05) + 0.018 * Math.sin(t * 2.4)
  const drift2 = 0.052 * Math.cos(t * 0.98) + 0.015 * Math.cos(t * 2.1)
  const breathe = 0.7 + 0.3 * Math.sin(t * 1.08)

  const swingMul =
    1 +
    0.18 *
      Math.min(1, Math.abs(omega) / 14) *
      (phase === 'swing' || phase === 'recovery' ? 1 : 0.3)

  const a0 = SHIMMER_INTENSITY * swingMul * breathe

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'

  const drawGlint = (
    gx: number,
    gy: number,
    radius: number,
    peak: number,
    mid: number
  ) => {
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, radius)
    g.addColorStop(0, `rgba(255, 252, 248, ${peak})`)
    g.addColorStop(0.4, `rgba(255, 232, 205, ${mid})`)
    g.addColorStop(1, 'rgba(255,210,175,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(gx, gy, radius, 0, Math.PI * 2)
    ctx.fill()
  }

  const rHelmet = statueW * 0.28
  const hx = statueX + statueW * (0.45 + drift * 1.2)
  const hy = statueY + statueH * (0.12 + drift2)
  drawGlint(hx, hy, rHelmet, a0 * 0.55, a0 * 0.28)

  const rShoulder = statueW * 0.24
  const sx = statueX + statueW * (0.52 - drift2 * 0.8)
  const sy = statueY + statueH * (0.27 + drift * 0.9)
  drawGlint(sx, sy, rShoulder, a0 * 0.42, a0 * 0.22)

  const handWx = statueX + statueHandInVisX * statueUniformScale
  const handWy = statueY + statueHandInVisY * statueUniformScale
  const rHand = statueW * 0.2
  drawGlint(
    handWx + drift * statueW * 0.15,
    handWy + drift2 * statueH * 0.08,
    rHand,
    a0 * 0.38,
    a0 * 0.2
  )

  ctx.restore()
}
