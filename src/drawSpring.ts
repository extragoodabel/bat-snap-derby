import type { Vec2 } from './physics'

/** Must match game `LauncherPhase`. */
export type SpringPhase = 'idle' | 'charging' | 'swing' | 'recovery'

export type SpringMotionInput = {
  phase: SpringPhase
  hingeTauSec: number | null
  batVisPhiRad: number
  batRestPhiRad: number
  omega: number
}

/** Target coil count along the span (scaled by length). */
export const SPRING_TURNS = 5.2

/** Base helix radius as fraction of min canvas side (readable coil, not a hairline). */
export const SPRING_COIL_AMP_FR = 0.0082

/** Mid-span bow from bat angle (fraction of minDim); keeps middle busy while ends stay fixed. */
export const SPRING_ANGLE_BOW_FR = 0.0034

export const SPRING_HINGE_PEAK_FR = 0.022

export const SPRING_HINGE_DECAY = 5.2
export const SPRING_HINGE_OMEGA_RAD = 17

export const SPRING_STROKE_MIN = 0.78
export const SPRING_STROKE_MAX_FR = 0.00195

/** Sub-pixel nudges only if art needs it; 0 uses layout opaque anchors as-is. */
export const SPRING_HAND_OFFSET_X_PX = 0
export const SPRING_HAND_OFFSET_Y_PX = 0

/**
 * Extra px along **⊥ bat** in world at **rest** (`batRestPhiRad`): `(-sin φ₀, cos φ₀)`.
 * Folded into bat-local attachment with offsets so the spring end spins with the bat.
 */
export const SPRING_BAT_KNOB_PERP_OFFSET_PX = 0

/**
 * Screen-space offset from pivot → spring bat end when the bat is at `batRestPhiRad`
 * (same frame as `drawBatSprite`). Converted to bat-local and rotated with φ = θ + batRotDelta.
 */
export const SPRING_BAT_KNOB_OFFSET_X_PX = -10
export const SPRING_BAT_KNOB_OFFSET_Y_PX = 0

/** |ω| damping on coil radius (keep small so helix stays visible). */
export const SPRING_OMEGA_DAMP_SCALE = 0.018

const SPRING_SEGMENTS = 52
const SPRING_MIN_LEN_PX = 2.5
const SPRING_LEN_REF_FR = 0.19

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}

function wrapAngleRad(d: number): number {
  let x = d
  while (x > Math.PI) x -= Math.PI * 2
  while (x < -Math.PI) x += Math.PI * 2
  return x
}

/**
 * Coil plane: perpendicular to chord A→B, biased toward **screen-up** so the helix reads
 * as a vertical spring (lobes mostly up/down), not a sideways squiggle when the chord is steep.
 * Returns orthonormal N (coil) and M (secondary flex / hinge in the bat–hand plane).
 */
function verticalBiasedSpringBasis(
  ux: number,
  uy: number
): { nx: number; ny: number; mx: number; my: number } {
  const vpx = 0
  const vpy = -1
  const dot = vpx * ux + vpy * uy
  let wx = vpx - dot * ux
  let wy = vpy - dot * uy
  let wlen = Math.hypot(wx, wy)
  if (wlen < 0.06) {
    wx = -uy
    wy = ux
    wlen = Math.hypot(wx, wy) || 1
  }
  const nx = wx / wlen
  const ny = wy / wlen
  const mx = -ny
  const my = nx
  return { nx, ny, mx, my }
}

function effectiveTurns(L: number, canvasMinDim: number): number {
  const ref = canvasMinDim * SPRING_LEN_REF_FR
  const scaled = SPRING_TURNS * (L / Math.max(ref, 1))
  return clamp(scaled, 2.6, SPRING_TURNS + 0.4)
}

function hingeEnvelope(tauSec: number, canvasMinDim: number): number {
  const peak = canvasMinDim * SPRING_HINGE_PEAK_FR
  const w = SPRING_HINGE_OMEGA_RAD
  const d = SPRING_HINGE_DECAY
  return peak * Math.cos(w * tauSec) * Math.exp(-d * tauSec)
}

/**
 * `B` is sim pivot (rotation center) — bat sprite knob anchor.
 *
 * Bat end of the spring is a fixed point on the bat’s rotating plane: rest-tuned offset from
 * pivot in screen space at `batRestPhiRad` → inverse-rotated to bat-local → `R(φ_vis)` each frame.
 * Hand (opaque) → bat attachment (opaque). Helix along **N**; **M** flex for bow / hinge.
 */
export function drawSpring(
  ctx: CanvasRenderingContext2D,
  A: Vec2,
  B: Vec2,
  motion: SpringMotionInput,
  canvasMinDim: number,
  options?: { debug?: boolean; layoutScale?: number }
): void {
  const px = options?.layoutScale ?? 1
  const a: Vec2 = {
    x: A.x + SPRING_HAND_OFFSET_X_PX * px,
    y: A.y + SPRING_HAND_OFFSET_Y_PX * px,
  }
  const phi = motion.batVisPhiRad
  const phi0 = motion.batRestPhiRad
  const perp0X = -Math.sin(phi0)
  const perp0Y = Math.cos(phi0)
  /** World delta from pivot at rest (matches previous screen-fixed tuning when φ = φ₀). */
  const dwx =
    SPRING_BAT_KNOB_OFFSET_X_PX * px +
    SPRING_BAT_KNOB_PERP_OFFSET_PX * perp0X * px
  const dwy =
    SPRING_BAT_KNOB_OFFSET_Y_PX * px +
    SPRING_BAT_KNOB_PERP_OFFSET_PX * perp0Y * px
  const c0 = Math.cos(phi0)
  const s0 = Math.sin(phi0)
  const localX = c0 * dwx + s0 * dwy
  const localY = -s0 * dwx + c0 * dwy
  const c = Math.cos(phi)
  const s = Math.sin(phi)
  const b: Vec2 = {
    x: B.x + c * localX - s * localY,
    y: B.y + s * localX + c * localY,
  }

  const dx = b.x - a.x
  const dy = b.y - a.y
  const L = Math.hypot(dx, dy)
  if (L < SPRING_MIN_LEN_PX * px) return

  const ux = dx / L
  const uy = dy / L
  const { nx, ny, mx, my } = verticalBiasedSpringBasis(ux, uy)

  const dBat = wrapAngleRad(motion.batVisPhiRad - motion.batRestPhiRad)
  const omegaAbs = Math.abs(motion.omega)
  const omegaDamp = 1 / (1 + omegaAbs * SPRING_OMEGA_DAMP_SCALE)

  /** More separation from straight chord when the bat is pulled off rest (middle works harder). */
  const angleSpread = 1 - Math.cos(dBat)
  const coilAmp =
    canvasMinDim *
    SPRING_COIL_AMP_FR *
    omegaDamp *
    clamp(0.82 + 0.95 * angleSpread, 0.75, 1.95)

  const turns = effectiveTurns(L, canvasMinDim)

  const flexBow = canvasMinDim * SPRING_ANGLE_BOW_FR * angleSpread
  const flexHit =
    motion.hingeTauSec != null &&
    (motion.phase === 'swing' || motion.phase === 'recovery')
      ? hingeEnvelope(motion.hingeTauSec, canvasMinDim)
      : 0
  const flexMid = flexBow + flexHit * 0.9

  const strokeMain = clamp(
    canvasMinDim * SPRING_STROKE_MAX_FR,
    SPRING_STROKE_MIN,
    1.72
  )
  const strokeHi = Math.max(0.65, strokeMain * 0.38)

  const pts: Vec2[] = []
  for (let i = 0; i <= SPRING_SEGMENTS; i++) {
    const t = i / SPRING_SEGMENTS
    const cx = a.x + ux * L * t
    const cy = a.y + uy * L * t
    const coilTaper = Math.sin(Math.PI * t) ** 2
    const coil =
      Math.sin(t * turns * Math.PI * 2) * coilAmp * coilTaper
    const flex = Math.sin(Math.PI * t) * flexMid
    pts.push({
      x: cx + nx * coil + mx * flex,
      y: cy + ny * coil + my * flex,
    })
  }

  pts[0] = { x: a.x, y: a.y }
  pts[pts.length - 1] = { x: b.x, y: b.y }

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y)
  }
  ctx.strokeStyle = 'rgba(38, 28, 20, 0.9)'
  ctx.lineWidth = strokeMain
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y)
  }
  ctx.strokeStyle = 'rgba(118, 92, 62, 0.38)'
  ctx.lineWidth = strokeHi
  ctx.stroke()

  if (options?.debug) {
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = 'rgba(0, 200, 255, 0.2)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    ctx.setLineDash([])

    const dot = (p: Vec2, fill: string) => {
      ctx.fillStyle = fill
      ctx.beginPath()
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2)
      ctx.fill()
    }
    dot(a, 'rgba(80, 200, 255, 0.85)')
    dot(b, 'rgba(255, 200, 80, 0.9)')
  }

  ctx.restore()
}
