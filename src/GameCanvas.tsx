import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { DISC_SX, ringScreenPoint } from './disc'
import {
  type Ball,
  batPointAlong,
  batTip,
  circlesOverlap,
  closestTOnBat,
  distSqPointSegment,
  integrateBall,
  type Vec2,
} from './physics'
import { useGameLoop } from './useGameLoop'

const ASPECT = 16 / 9
const GRAVITY = 700
/** Batted balls only: balanced with exit speed so balls stay lively but arc. */
const OUTGOING_GRAVITY = 468
const RING_OMEGA = 0.55
/** Concentric rows: index 0 = front/smallest, 2 = back/largest. */
const RING_COUNT = 3
const RING_TARGET_COUNTS: [number, number, number] = [7, 7, 8]
const BALL_R = 9
const TARGET_R = 16
/** Radial gap between nested rings (fraction of min(w,h)). */
const DISC_RING_GAP_FR = 0.026
/** Staggered gallery: each row deeper in perspective shifts up-left (fraction of min(w,h) per step). */
const GALLERY_DEPTH_STEP_X_FR = 0.024
const GALLERY_DEPTH_STEP_Y_FR = 0.028
/** Front row anchor (fraction of logical w/h); lowered so batter + board read on one plane. */
const GALLERY_FRONT_CX_FR = 0.36
const GALLERY_FRONT_CY_FR = 0.58

/**
 * Fixed machine lip in screen space (does not rotate with the wheel).
 * Rim points with screen Y below this line are occluded / inactive.
 */
const OCCLUDER_Y_BELOW_CENTER_FR = 0.1

const THETA_RIGHT = 0
const THETA_UP = -Math.PI / 2
const THETA_LEFT = -Math.PI
const THETA_REST = THETA_UP
const THETA_LAUNCH = THETA_REST

/**
 * Charge aim window = full upper semicircle (pointer space): θ from left (−π) to right (0).
 * Visual bat only; batted-ball aim comes from timing vs ideal contact, not bat tangent.
 */
const THETA_CHARGE_MIN = THETA_LEFT
const THETA_CHARGE_MAX = THETA_RIGHT

const POWER_DEADZONE = 0.04

/** Max |θ − rest| on the charge arc (symmetric about THETA_UP); used for pullback u ∈ [0,1]. */
const PULLBACK_MAX_RAD = Math.max(
  THETA_REST - THETA_CHARGE_MIN,
  THETA_CHARGE_MAX - THETA_REST
)

const OMEGA_BASE = 5.0
const OMEGA_SCALE = 7.5
const SWING_DAMPING = 2.35
/** Extra whip on release (Ichiro-style forward crack). */
const SWING_WHIP_MULT = 1.52
/** Lighter damping while carrying through full recovery loop. */
const RECOVERY_DAMPING = 1.05
/** Brief boost to keep loop snappy after ball leaves. */
const RECOVERY_OMEGA_CARRY = 1.12
const TWO_PI = Math.PI * 2
/** Damped spring on final approach to rest. */
const SETTLE_SPRING_K = 68
const SETTLE_OMEGA_DRAG = 4.2
/** Small upward (CCW) kick at rest for athletic reverb. */
const SETTLE_BOUNCE_OMEGA = 3.4
const SETTLE_SNAP_ANGLE = 0.045
const SETTLE_SNAP_OMEGA = 0.35
/** Early swing: no grab (avoids fighting spawn). */
const SWING_GRAB_LOCKOUT_SEC = 0.1

/** Power zones (release p). Minor speed nudge on batted ball; timing drives outcome. */
const POWER_STRONG = 0.75
const POWER_FULL_SEND = 0.9
const POWER_PERFECT_SEND = 0.97

const BASE_HIT_SCORE = 100
const CHAIN_ANGLE_RAD = 0.42
const PIERCE_SPEED_MUL = 0.62
const TRAIL_MAX = 22
const FLASH_FULL_SEND = 0.2
const FLASH_PERFECT_SEND = 0.34
const SHAKE_PERFECT = 0.22

const PREVIEW_DT = 0.048
const PREVIEW_STEPS = 32

/** After pull-back, delay before the mound fires (readable telegraph). */
const PITCH_ARM_DELAY_SEC = 0.32
/** Incoming pitch speed band (px/s); fast, batting-like. */
const PITCH_SPEED_MIN = 1260
const PITCH_SPEED_MAX = 1680
/** Small vertical accel on incoming ball only (shallow arc; not full gravity). */
const PITCH_INCOMING_AY_MIN = -140
const PITCH_INCOMING_AY_MAX = 120
/** Contact height along bat: upper ~half of barrel (t from pivot→tip, 1 = tip). */
const PITCH_CONTACT_FR_MIN = 0.52
const PITCH_CONTACT_FR_MAX = 0.94
/** Release point horizontal (fraction of w); left of plate for mostly +x travel. */
const PITCH_MOUND_X_FR = 0.31
/** Tiny start Y offset vs target (px-ish scale via minDim) for slight plane variety. */
const PITCH_RELEASE_DY_FR = 0.018
/** Sweet spot: upper-mid barrel (t along bat); radius as fraction of bat length. */
const SWEET_SPOT_T = 0.74
const SWEET_SPOT_RADIUS_FR = 0.2
/** Auto pitch if idle this long (s) with no ball in play. */
const AUTO_PITCH_IDLE_SEC = 5
/** Generous plate + upper-barrel contact read. */
const CONTACT_ZONE_R = 142
/**
 * |timingError| ≤ PERFECT → best tier; ≤ GOOD → solid hit; ≤ POOR → weak; else dribble;
 * beyond MISS → no batted ball (passed through).
 */
const TIMING_PERFECT_SEC = 0.048
const TIMING_GOOD_SEC = 0.13
const TIMING_POOR_SEC = 0.24
const TIMING_MISS_SEC = 0.44
/** Outgoing exit-speed band (px/s); pullback sets band, timing/barrel trim — not stacked into mush. */
const OUT_SPEED_MIN = 920
const OUT_SPEED_MAX = 2480
const OUT_SPEED_DRIBBLE = 620
/** Fine trim on top of aim-point steering (sweet spot steadies the barrel). */
const TIMING_YAW_MAX_RAD = 0.42
/** Pullback adds launch loft on top of aim-based plane. */
const PULLBACK_LOFT_MAX_RAD = 0.44
/** Small constant loft so fair balls don’t knife into the dirt. */
const FAIR_CONTACT_BASE_LOFT_RAD = 0.055
const DRIBBLE_BASE_LOFT_RAD = 0.032
/** Off-barrel wobble — keep smaller so good contact feels crisp, not slot-like. */
const OFF_BARREL_ANGLE_SCATTER_RAD = 0.2

/** Exit reward: only high combined pullback × timing × sweet unlocks moonshot. */
const EXIT_SCORE_MOONSHOT = 0.885
const EXIT_SCORE_POWER = 0.765
const EXIT_SCORE_CARRY = 0.628
/** Batter pivot height (fraction of canvas h); higher on screen = smaller fraction. */
const BAT_PIVOT_X_FR = 0.88
const BAT_PIVOT_Y_FR = 0.74
/** Past this offset from plate center X, pitch is “gone” if unresolved. */
const BALL_PAST_PLATE_DX = 92

const GRAB_THRESH_PX = 52
const GRAB_THRESH_SQ = GRAB_THRESH_PX * GRAB_THRESH_PX
const RIM_INNER_FR = 0.82

type LauncherPhase = 'idle' | 'charging' | 'swing' | 'recovery'

type BallRole = 'none' | 'incoming' | 'outgoing'

/** Debug / HUD pitch lifecycle (not all mutually exclusive with ballRole). */
type PitchHudState =
  | 'idle'
  | 'armed'
  | 'incoming'
  | 'contact'
  | 'outgoing'

type PowerTier =
  | 'normal'
  | 'strong'
  | 'full_send'
  | 'perfect_full_send'

/** Top-end batted-ball reward ladder (separate from score tier / pierce). */
type ExitRewardBand = 'standard' | 'carry' | 'power' | 'moonshot'

type ContactQualityBucket =
  | 'miss'
  | 'dribble'
  | 'poor_early'
  | 'poor_late'
  | 'good_early'
  | 'good_late'
  | 'perfect'

function clamp(v: number, a: number, b: number): number {
  return Math.min(Math.max(v, a), b)
}

/** Deterministic per-pitch variant in [0, 1). */
function pitchVariant01(n: number, salt: number): number {
  const x = Math.sin(n * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

/** Stored swing load from bat angle on the charge arc (not oscillating). */
function pullbackNormalizedFromVisualTheta(theta: number): number {
  return clamp(Math.abs(theta - THETA_REST) / PULLBACK_MAX_RAD, 0, 1)
}

function pointerToBatThetaRaw(px: number, py: number, ptr: Vec2): number {
  const phi = Math.atan2(ptr.y - py, ptr.x - px)
  if (phi > 0) {
    if (Math.abs(phi - Math.PI) < 0.02) return THETA_LEFT
    return THETA_RIGHT
  }
  return clamp(phi, THETA_LEFT, THETA_RIGHT)
}

function thetaChargeFromPointer(px: number, py: number, ptr: Vec2): number {
  const raw = pointerToBatThetaRaw(px, py, ptr)
  return clamp(raw, THETA_CHARGE_MIN, THETA_CHARGE_MAX)
}

/** Ease-out: strong gains early, compressed top end so max p is not absurdly faster. */
function powerToSpeedFactor(p: number): number {
  const c = clamp(p, 0, 1)
  return 1 - (1 - c) * (1 - c)
}

function classifyPowerTier(p: number): PowerTier {
  const c = clamp(p, 0, 1)
  if (c >= POWER_PERFECT_SEND) return 'perfect_full_send'
  if (c >= POWER_FULL_SEND) return 'full_send'
  if (c >= POWER_STRONG) return 'strong'
  return 'normal'
}

function scoreMultiplier(tier: PowerTier): number {
  switch (tier) {
    case 'perfect_full_send':
      return 2.0
    case 'full_send':
      return 1.5
    case 'strong':
      return 1.15
    default:
      return 1.0
  }
}

function isFullSendZone(p: number): boolean {
  return clamp(p, 0, 1) >= POWER_FULL_SEND
}

function isPerfectSendZone(p: number): boolean {
  return clamp(p, 0, 1) >= POWER_PERFECT_SEND
}

function powerBarColor(p: number): string {
  const a = clamp(p, 0, 1)
  if (a < 0.5) {
    const t = a / 0.5
    const r = Math.round(68 + (255 - 68) * t)
    const g = Math.round(136 + (204 - 136) * t)
    const b = Math.round(255 + (68 - 255) * t)
    return `rgb(${r},${g},${b})`
  }
  const t = (a - 0.5) / 0.5
  const r = Math.round(255 + (255 - 255) * t)
  const g = Math.round(204 + (68 - 204) * t)
  const b = Math.round(68 + (34 - 68) * t)
  return `rgb(${r},${g},${b})`
}

type TargetSlotState = {
  wasTriggered: boolean
  /** Was behind the fixed occluder (masked region). */
  wasInLowerHalf: boolean
  /** Previous frame: rim point was in exposed region above fixed occluder. */
  prevIsUpper: boolean
  isActive: boolean
  /** Rim point currently above fixed occluder (exposed / “live” arc). */
  isCurrentlyUpperHalf: boolean
  debugCrossDown: boolean
  debugCrossUp: boolean
}

type DiscWheelRing = {
  /** Row hub in screen space (staggered for depth; front = closest). */
  center: Vec2
  radiusOuter: number
  radiusInner: number
  /** Current orientation (rad); each ring advances by its own omega. */
  rotation: number
  /** Signed angular velocity (rad/s); alternates by ring. */
  omega: number
  slotAngles: number[]
  targetSlots: TargetSlotState[]
}

type Sim = {
  w: number
  h: number
  dpr: number
  pivot: Vec2
  batLen: number
  /** Three staggered rows in perspective; [0] front/smallest … [2] back/largest. */
  rings: DiscWheelRing[]
  /** True when every target in the exposed (above-occluder) region has wasTriggered (all rings). */
  debugAllTargetsTriggered: boolean
  ball: Ball | null

  phase: LauncherPhase
  theta: number
  omega: number
  chargeElapsed: number
  pCurrent: number
  pRelease: number
  thetaRelease: number
  /** True after bat crosses launch plane this swing; used only for swing→recovery transition. */
  swingCrossedLaunch: boolean
  prevTheta: number

  ballRole: BallRole
  /** Seconds held in charge while arming next pitch (resets on new grab). */
  pitchArmElapsed: number

  /** Full CCW recovery: unwrapped θ target (one lap below launch crossing). */
  recoveryTargetTheta: number
  /** Final damped bounce onto THETA_REST. */
  recoverySettling: boolean
  /** Post-release window where grab is disabled (swing only). */
  swingGrabLockoutRemain: number
  /** HUD: recent manual interrupt of swing/recovery. */
  batInterruptFlashRemain: number

  /** Tier from last valid release (swing + in-flight ball). */
  powerTierRelease: PowerTier
  /** Active ball hit tier (copied at spawn). */
  ballShotTier: PowerTier
  /** Perfect full send: first hit pierces (ball survives once). */
  ballPierceArmed: boolean
  /** Active outgoing: reward band from last contact (trail / labels). */
  ballExitBand: ExitRewardBand
  /** Outgoing gravity scale (elite = gentler drop for carry). */
  ballOutgoingGravityMul: number

  score: number
  releaseFlashRemain: number
  releaseFlashTier: PowerTier | null
  shakeRemain: number
  ballTrail: Vec2[]

  pointer: Vec2 | null
  /** Monotonic sim clock (s) for pitch + swing timing. */
  simTime: number
  /** World time when ball should cross the plate; -1 if none. */
  idealContactTime: number
  /** When bat crossed the launch plane this swing; null until then. */
  batCrossLaunchTime: number | null
  /** Per-pitch: contact/miss already decided. */
  pitchContactResolved: boolean

  /** Monotonic pitch id for deterministic variation. */
  pitchSeq: number
  /** Intended contact height along bat (0 pivot → 1 tip) for this pitch. */
  pitchContactFracT: number
  pitchSpeedNominal: number
  /** Incoming-only vertical acceleration (shallow arc). */
  pitchIncomingAy: number
  pitchReleaseDyPx: number
  /** Seconds spent idle with no ball; triggers auto pitch. */
  idleAutoPitchAccum: number

  debugLaunchDir: { x: number; y: number }
  debugPitchHud: PitchHudState
  debugIncomingVel: Vec2 | null
  debugOutgoingVel: Vec2 | null
  debugContactPoint: Vec2 | null
  debugPredictedPostHitVel: Vec2 | null
  debugPreviewMatchesActual: boolean
  debugContactFlash: number
  debugContactBucket: ContactQualityBucket
  debugTimingErrorSec: number | null
  debugSwingCrossTime: number | null
  debugPredictedTimingErrorSec: number | null
  debugLaunchAngleDeg: number
  debugLaunchSpeed: number
  debugSweetQPreview: number
  debugSweetQAtContact: number
  debugContactAlongT: number
  debugTransferEff: number
  debugPullbackUAtContact: number
  debugAutoPitch: boolean
  debugExitBandPreview: ExitRewardBand
  debugLastExitBand: ExitRewardBand
}

function ringMidRadius(Ro: number): number {
  const Ri = Ro * RIM_INNER_FR
  return (Ro + Ri) / 2
}

function ringMidFromDiscRing(ring: DiscWheelRing): number {
  return (ring.radiusOuter + ring.radiusInner) / 2
}

function makeSlotAngles(slotCount: number): number[] {
  return Array.from({ length: slotCount }, (_, i) => (i / slotCount) * Math.PI * 2)
}

/** Outer radii nested inward: ring[2] largest … ring[0] smallest, with gaps. */
function layoutDiscRingRadii(minDim: number): { ro: number; ri: number }[] {
  const gap = minDim * DISC_RING_GAP_FR
  const R3o = minDim * 0.3
  const R3i = R3o * RIM_INNER_FR
  const R2o = R3i - gap
  const R2i = R2o * RIM_INNER_FR
  const R1o = R2i - gap
  const R1i = R1o * RIM_INNER_FR
  return [
    { ro: R1o, ri: R1i },
    { ro: R2o, ri: R2i },
    { ro: R3o, ri: R3i },
  ]
}

/** Front row at anchor; deeper rows offset up-left for perspective read. */
function layoutGalleryRingCenters(w: number, h: number): Vec2[] {
  const m = Math.min(w, h)
  const fx = w * GALLERY_FRONT_CX_FR
  const fy = h * GALLERY_FRONT_CY_FR
  const sx = m * GALLERY_DEPTH_STEP_X_FR
  const sy = m * GALLERY_DEPTH_STEP_Y_FR
  return [
    { x: fx, y: fy },
    { x: fx - sx, y: fy - sy },
    { x: fx - 2 * sx, y: fy - 2 * sy },
  ]
}

function createDiscRingsForLayout(w: number, h: number): DiscWheelRing[] {
  const minDim = Math.min(w, h)
  const radii = layoutDiscRingRadii(minDim)
  const centers = layoutGalleryRingCenters(w, h)
  return radii.map((dims, r) => {
    const omega = r % 2 === 0 ? RING_OMEGA : -RING_OMEGA
    const n = RING_TARGET_COUNTS[r]
    const slotAngles = makeSlotAngles(n)
    return {
      center: centers[r],
      radiusOuter: dims.ro,
      radiusInner: dims.ri,
      rotation: 0,
      omega,
      slotAngles,
      targetSlots: createInitialTargetSlots(centers[r], 0, slotAngles, dims.ro),
    }
  })
}

function syncGalleryLayout(sim: Sim, w: number, h: number): void {
  const minDim = Math.min(w, h)
  const radii = layoutDiscRingRadii(minDim)
  const centers = layoutGalleryRingCenters(w, h)
  for (let r = 0; r < RING_COUNT; r++) {
    sim.rings[r].radiusOuter = radii[r].ro
    sim.rings[r].radiusInner = radii[r].ri
    sim.rings[r].center = centers[r]
  }
}

/** Horizontal lip line for this row; fixed in screen space while the disc spins. */
function fixedOccluderScreenY(ring: DiscWheelRing): number {
  return fixedOccluderYForCenter(ring.center.y, ring.radiusOuter)
}

function fixedOccluderYForCenter(cy: number, radiusOuter: number): number {
  return cy + radiusOuter * OCCLUDER_Y_BELOW_CENTER_FR
}

/** Target is in the exposed (live) region iff its rim point lies above the fixed occluder. */
function targetIsExposedAboveOccluder(
  ring: DiscWheelRing,
  Rmid: number,
  worldAngle: number
): boolean {
  const p = ringScreenPoint(
    ring.center.x,
    ring.center.y,
    DISC_SX,
    Rmid,
    worldAngle
  )
  return p.y < fixedOccluderYForCenter(ring.center.y, ring.radiusOuter)
}

function createInitialTargetSlots(
  center: Vec2,
  ringRotation: number,
  slotAngles: number[],
  Ro: number
): TargetSlotState[] {
  const Rmid = ringMidRadius(Ro)
  return Array.from({ length: slotAngles.length }, (_, i) => {
    const a = ringRotation + slotAngles[i]
    const p = ringScreenPoint(center.x, center.y, DISC_SX, Rmid, a)
    const isUpper = p.y < fixedOccluderYForCenter(center.y, Ro)
    return {
      wasTriggered: false,
      wasInLowerHalf: false,
      prevIsUpper: isUpper,
      isActive: isUpper,
      isCurrentlyUpperHalf: isUpper,
      debugCrossDown: false,
      debugCrossUp: false,
    }
  })
}

/**
 * Carnival wheel behind a fixed lip: exposed region = rim above occluder line in screen space.
 * Targets re-arm when they rotate from behind the mask back into the exposed arc.
 */
function updateDiscTargetStates(sim: Sim): void {
  for (const ring of sim.rings) {
    const Rmid = ringMidFromDiscRing(ring)
    for (let i = 0; i < ring.targetSlots.length; i++) {
      const a = ring.rotation + ring.slotAngles[i]
      const isUpper = targetIsExposedAboveOccluder(ring, Rmid, a)
      const s = ring.targetSlots[i]

      s.debugCrossDown = false
      s.debugCrossUp = false

      if (s.prevIsUpper && !isUpper) {
        s.debugCrossDown = true
        s.wasInLowerHalf = true
      }
      if (!s.prevIsUpper && isUpper) {
        s.debugCrossUp = true
        if (s.wasInLowerHalf) {
          s.wasTriggered = false
          s.wasInLowerHalf = false
        }
      }

      if (!isUpper) {
        s.isActive = false
      } else {
        s.isActive = !s.wasTriggered
      }

      s.isCurrentlyUpperHalf = isUpper
      s.prevIsUpper = isUpper
    }
  }

  sim.debugAllTargetsTriggered = sim.rings.every((ring) =>
    ring.targetSlots.every((s) => {
      if (!s.isCurrentlyUpperHalf) return true
      return s.wasTriggered
    })
  )
}

/** After mid-frame wasTriggered changes (hit / chain), refresh isActive without re-running crossings. */
function refreshTargetActiveFlags(sim: Sim): void {
  for (const ring of sim.rings) {
    const Rmid = ringMidFromDiscRing(ring)
    for (let i = 0; i < ring.targetSlots.length; i++) {
      const a = ring.rotation + ring.slotAngles[i]
      const isUpper = targetIsExposedAboveOccluder(ring, Rmid, a)
      const s = ring.targetSlots[i]
      s.isCurrentlyUpperHalf = isUpper
      if (!isUpper) s.isActive = false
      else s.isActive = !s.wasTriggered
    }
  }
  sim.debugAllTargetsTriggered = sim.rings.every((ring) =>
    ring.targetSlots.every((s) => {
      if (!s.isCurrentlyUpperHalf) return true
      return s.wasTriggered
    })
  )
}

/** Dev overlay: fixed occluder edge (stationary in screen space; wheel spins behind it). */
function drawFixedOccluderEdgeDebug(
  ctx: CanvasRenderingContext2D,
  ring: DiscWheelRing
): void {
  const y = fixedOccluderScreenY(ring)
  const { x: cx } = ring.center
  const halfSpan = DISC_SX * ring.radiusOuter * 1.2 + 14
  ctx.save()
  ctx.strokeStyle = 'rgba(0, 255, 200, 0.88)'
  ctx.lineWidth = 2.5
  ctx.setLineDash([6, 4])
  ctx.beginPath()
  ctx.moveTo(cx - halfSpan, y)
  ctx.lineTo(cx + halfSpan, y)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()
}

/**
 * Clip drawing to the half-plane above the fixed occluder (smaller screen Y = higher on screen).
 * Wheel graphics are culled as if passing behind a stationary machine lip.
 */
function clipToRegionAboveOccluderY(
  ctx: CanvasRenderingContext2D,
  occluderY: number,
  worldW: number
): void {
  const pad = 800
  ctx.beginPath()
  ctx.moveTo(-pad, -pad)
  ctx.lineTo(worldW + pad, -pad)
  ctx.lineTo(worldW + pad, occluderY)
  ctx.lineTo(-pad, occluderY)
  ctx.closePath()
  ctx.clip()
}

function drawRingRowTargets(
  ctx: CanvasRenderingContext2D,
  ring: DiscWheelRing,
  ringIdx: number,
  revealLabels: boolean
): void {
  const Rmid = ringMidFromDiscRing(ring)
  const { x: cx, y: cy } = ring.center
  const order = Array.from({ length: ring.targetSlots.length }, (_, i) => i)
  order.sort((i, j) => {
    const ya = ringScreenPoint(
      cx,
      cy,
      DISC_SX,
      Rmid,
      ring.rotation + ring.slotAngles[i]
    ).y
    const yb = ringScreenPoint(
      cx,
      cy,
      DISC_SX,
      Rmid,
      ring.rotation + ring.slotAngles[j]
    ).y
    return ya - yb
  })

  for (const i of order) {
    const a = ring.rotation + ring.slotAngles[i]
    const pt = ringScreenPoint(cx, cy, DISC_SX, Rmid, a)
    const slot = ring.targetSlots[i]
    const upper = slot.isCurrentlyUpperHalf
    const active = slot.isActive
    const pal = RING_TARGET_PALETTE[ringIdx] ?? RING_TARGET_PALETTE[0]

    ctx.beginPath()
    ctx.arc(pt.x, pt.y, TARGET_R, 0, Math.PI * 2)
    if (!upper) {
      ctx.fillStyle = 'rgba(72, 78, 92, 0.38)'
      ctx.strokeStyle = 'rgba(55, 60, 72, 0.55)'
      ctx.lineWidth = 1.5
      ctx.fill()
      ctx.stroke()
    } else if (active) {
      ctx.fillStyle = pal.liveFill
      ctx.strokeStyle = pal.liveStroke
      ctx.lineWidth = 2.25
      ctx.fill()
      ctx.stroke()
    } else {
      ctx.fillStyle = 'rgba(90, 95, 110, 0.22)'
      ctx.strokeStyle = 'rgba(160, 140, 100, 0.75)'
      ctx.lineWidth = 2.5
      ctx.stroke()
    }

    if (revealLabels) {
      ctx.save()
      ctx.font = '9px ui-monospace, monospace'
      ctx.fillStyle = 'rgba(255,255,255,0.72)'
      const tag = upper ? (active ? 'LIVE' : 'hit') : 'off'
      ctx.fillText(`${ringIdx}:${tag}`, pt.x - 12, pt.y + 4)
      ctx.restore()
    }
  }
}

function drawGalleryRowCenterDebug(
  ctx: CanvasRenderingContext2D,
  rings: DiscWheelRing[]
): void {
  const colors = ['#6cf', '#fc6', '#c8f']
  for (let r = 0; r < RING_COUNT; r++) {
    const c = rings[r].center
    ctx.fillStyle = colors[r] ?? '#fff'
    ctx.beginPath()
    ctx.arc(c.x, c.y, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.font = 'bold 9px ui-monospace, monospace'
    ctx.fillText(String(r), c.x + 7, c.y + 3)
  }
}

export type DevDrawOptions = {
  /** Clip ring + pegs to disc upper half (lower half not drawn). */
  clipDiscLowerHalf: boolean
  /** Show full wheel + separator + peg labels; overrides clipping for debugging. */
  revealHiddenLayers: boolean
  /** Top-left launcher / physics readout. */
  showLauncherDebugHud: boolean
}

function createSim(w: number, h: number): Sim {
  const pivot: Vec2 = { x: w * BAT_PIVOT_X_FR, y: h * BAT_PIVOT_Y_FR }
  const batLen = Math.min(w, h) * 0.2
  const rings = createDiscRingsForLayout(w, h)
  return {
    w,
    h,
    dpr: 1,
    pivot,
    batLen,
    rings,
    debugAllTargetsTriggered: false,
    ball: null,
    phase: 'idle',
    theta: THETA_REST,
    omega: 0,
    chargeElapsed: 0,
    pCurrent: 0,
    pRelease: 0,
    thetaRelease: THETA_REST,
    swingCrossedLaunch: false,
    prevTheta: THETA_REST,
    ballRole: 'none',
    pitchArmElapsed: 0,
    recoveryTargetTheta: THETA_REST,
    recoverySettling: false,
    swingGrabLockoutRemain: 0,
    batInterruptFlashRemain: 0,
    powerTierRelease: 'normal',
    ballShotTier: 'normal',
    ballPierceArmed: false,
    ballExitBand: 'standard',
    ballOutgoingGravityMul: 1,
    score: 0,
    releaseFlashRemain: 0,
    releaseFlashTier: null,
    shakeRemain: 0,
    ballTrail: [],
    pointer: null,
    simTime: 0,
    idealContactTime: -1,
    batCrossLaunchTime: null,
    pitchContactResolved: false,
    pitchSeq: 0,
    pitchContactFracT: SWEET_SPOT_T,
    pitchSpeedNominal: (PITCH_SPEED_MIN + PITCH_SPEED_MAX) / 2,
    pitchIncomingAy: (PITCH_INCOMING_AY_MIN + PITCH_INCOMING_AY_MAX) / 2,
    pitchReleaseDyPx: 0,
    idleAutoPitchAccum: 0,
    debugLaunchDir: { x: -0.92, y: -0.38 },
    debugPitchHud: 'idle',
    debugIncomingVel: null,
    debugOutgoingVel: null,
    debugContactPoint: null,
    debugPredictedPostHitVel: null,
    debugPreviewMatchesActual: false,
    debugContactFlash: 0,
    debugContactBucket: 'miss',
    debugTimingErrorSec: null,
    debugSwingCrossTime: null,
    debugPredictedTimingErrorSec: null,
    debugLaunchAngleDeg: 0,
    debugLaunchSpeed: 0,
    debugSweetQPreview: 0,
    debugSweetQAtContact: 0,
    debugContactAlongT: 0,
    debugTransferEff: 0,
    debugPullbackUAtContact: 0,
    debugAutoPitch: false,
    debugExitBandPreview: 'standard',
    debugLastExitBand: 'standard',
  }
}

function layoutSim(sim: Sim, w: number, h: number): void {
  sim.w = w
  sim.h = h
  sim.pivot = { x: w * BAT_PIVOT_X_FR, y: h * BAT_PIVOT_Y_FR }
  sim.batLen = Math.min(w, h) * 0.2
  syncGalleryLayout(sim, w, h)
}

function pointerToLogical(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  sim: Sim
): Vec2 {
  const nx = (clientX - rect.left) / rect.width
  const ny = (clientY - rect.top) / rect.height
  return { x: nx * sim.w, y: ny * sim.h }
}

function nearBat(sim: Sim): boolean {
  if (!sim.pointer) return false
  const tip = batTip(sim.pivot, sim.batLen, sim.theta)
  const d2 = distSqPointSegment(
    sim.pointer.x,
    sim.pointer.y,
    sim.pivot.x,
    sim.pivot.y,
    tip.x,
    tip.y
  )
  return d2 <= GRAB_THRESH_SQ
}

/** Screen-space bounds of the disc gallery (for aim points that stay on the board). */
function galleryPlayBounds(sim: Sim): {
  cx: number
  cy: number
  halfW: number
  halfH: number
} {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let r = 0; r < RING_COUNT; r++) {
    const ring = sim.rings[r]
    const rx = DISC_SX * ring.radiusOuter
    const ry = ring.radiusOuter
    minX = Math.min(minX, ring.center.x - rx)
    maxX = Math.max(maxX, ring.center.x + rx)
    minY = Math.min(minY, ring.center.y - ry)
    maxY = Math.max(maxY, ring.center.y + ry)
  }
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    halfW: (maxX - minX) / 2,
    halfH: (maxY - minY) / 2,
  }
}

function classifyContactBucket(timingErrorSec: number): ContactQualityBucket {
  const ae = Math.abs(timingErrorSec)
  if (ae > TIMING_MISS_SEC) return 'miss'
  if (ae > TIMING_POOR_SEC) return 'dribble'
  if (ae > TIMING_GOOD_SEC) return timingErrorSec < 0 ? 'poor_early' : 'poor_late'
  if (ae > TIMING_PERFECT_SEC)
    return timingErrorSec < 0 ? 'good_early' : 'good_late'
  return 'perfect'
}

function contactQuality01(timingErrorSec: number): number {
  const ae = Math.abs(timingErrorSec)
  /** Softer floor: “close” swings stay energetic; only poor timing really bleeds power. */
  return clamp(1 - ae / TIMING_GOOD_SEC, 0.4, 1)
}

function powerTierFromTimingAbs(absErr: number): PowerTier {
  if (absErr <= TIMING_PERFECT_SEC) return 'perfect_full_send'
  if (absErr <= TIMING_GOOD_SEC * 0.5) return 'full_send'
  if (absErr <= TIMING_GOOD_SEC) return 'strong'
  return 'normal'
}

/** Planned contact point on the launch-plane bat for the current pitch params. */
function pitchPlannedContactPoint(sim: Sim): Vec2 {
  return batPointAlong(
    sim.pivot,
    sim.batLen,
    THETA_LAUNCH,
    sim.pitchContactFracT
  )
}

/** 1 at sweet-spot center, 0 outside radius (in bat t-space). */
function sweetSpotQuFromT(tAlongBat: number): number {
  const d = Math.abs(tAlongBat - SWEET_SPOT_T)
  const r = SWEET_SPOT_RADIUS_FR
  if (d >= r) return 0
  const u = d / r
  return 1 - u * u
}

function pickPitchVariantParams(sim: Sim): void {
  const n = sim.pitchSeq
  const m = Math.min(sim.w, sim.h)
  const a0 = pitchVariant01(n, 1)
  const a1 = pitchVariant01(n, 2)
  const a2 = pitchVariant01(n, 3)
  const a3 = pitchVariant01(n, 4)
  sim.pitchContactFracT =
    PITCH_CONTACT_FR_MIN +
    a0 * (PITCH_CONTACT_FR_MAX - PITCH_CONTACT_FR_MIN)
  sim.pitchSpeedNominal =
    PITCH_SPEED_MIN + a1 * (PITCH_SPEED_MAX - PITCH_SPEED_MIN)
  sim.pitchIncomingAy =
    PITCH_INCOMING_AY_MIN +
    a2 * (PITCH_INCOMING_AY_MAX - PITCH_INCOMING_AY_MIN)
  sim.pitchReleaseDyPx = (a3 - 0.5) * 2 * PITCH_RELEASE_DY_FR * m
}

function combinedTransfer(
  quality: number,
  sweetQu: number,
  pullbackU: number
): number {
  const sw = 0.38 + 0.62 * sweetQu
  const pu = 0.48 + 0.52 * pullbackU
  return clamp(0.28 + 0.72 * quality * sw * pu, 0, 1)
}

function powerTierFromContact(transfer: number, absErr: number): PowerTier {
  if (transfer < 0.34) return 'normal'
  const base = powerTierFromTimingAbs(absErr)
  if (transfer < 0.48 && base === 'perfect_full_send') return 'full_send'
  if (transfer < 0.42 && (base === 'full_send' || base === 'perfect_full_send'))
    return 'strong'
  return base
}

/**
 * Early (−) vs late (+) steering across the board; small magnitude in perfect window (center lane).
 */
function timingSteerForBoard(errSec: number): number {
  const p = TIMING_PERFECT_SEC
  const g = TIMING_GOOD_SEC
  const a = Math.abs(errSec)
  if (a <= p) {
    return (errSec / Math.max(p, 1e-6)) * 0.17
  }
  const sign = Math.sign(errSec)
  const past = a - p
  const span = Math.max(g - p, 1e-6)
  const u = clamp(past / span, 0, 1)
  const u2 = u * u
  return sign * (0.17 + u2 * 0.93)
}

function classifyExitRewardBand(
  pu: number,
  quality: number,
  sweetQu: number,
  bucket: ContactQualityBucket
): ExitRewardBand {
  if (
    bucket === 'dribble' ||
    bucket === 'poor_early' ||
    bucket === 'poor_late'
  ) {
    return 'standard'
  }
  const linear = 0.34 * pu + 0.33 * quality + 0.33 * sweetQu
  const triple = pu * quality * (0.1 + 0.9 * sweetQu)
  const score =
    0.4 * linear + 0.6 * Math.pow(clamp(triple, 0, 1), 0.4)

  if (
    score >= EXIT_SCORE_MOONSHOT &&
    pu >= 0.83 &&
    quality >= 0.85 &&
    sweetQu >= 0.66
  ) {
    return 'moonshot'
  }
  if (
    score >= EXIT_SCORE_POWER &&
    pu >= 0.68 &&
    quality >= 0.7 &&
    sweetQu >= 0.32
  ) {
    return 'power'
  }
  if (score >= EXIT_SCORE_CARRY && pu >= 0.46 && quality >= 0.48) {
    return 'carry'
  }
  return 'standard'
}

function exitBandBonuses(band: ExitRewardBand): {
  loftRad: number
  speedMul: number
  gravityMul: number
} {
  switch (band) {
    case 'moonshot':
      return { loftRad: 0.44, speedMul: 1.24, gravityMul: 0.62 }
    case 'power':
      return { loftRad: 0.22, speedMul: 1.1, gravityMul: 0.76 }
    case 'carry':
      return { loftRad: 0.11, speedMul: 1.036, gravityMul: 0.88 }
    default:
      return { loftRad: 0, speedMul: 1, gravityMul: 1 }
  }
}

/**
 * Baseball-style contact: launch angle + exit speed from timing (steer), sweet-spot (clean/variance),
 * and pullback (force band). Same function drives live hit and dotted preview.
 * Top exit bands add clean loft + carry (moonshot can clear the board).
 */
function battedBallOutcome(
  sim: Sim,
  timingErrorSec: number,
  fromX: number,
  fromY: number,
  pullbackU: number,
  sweetQu: number
): {
  vx: number
  vy: number
  bucket: ContactQualityBucket
  tier: PowerTier
  speed: number
  aimDeg: number
  transferEff: number
  exitBand: ExitRewardBand
  outgoingGravityMul: number
} {
  const bucket = classifyContactBucket(timingErrorSec)
  if (bucket === 'miss') {
    return {
      vx: 0,
      vy: 0,
      bucket,
      tier: 'normal',
      speed: 0,
      aimDeg: 0,
      transferEff: 0,
      exitBand: 'standard',
      outgoingGravityMul: 1,
    }
  }
  const quality = contactQuality01(timingErrorSec)
  const transfer = combinedTransfer(quality, sweetQu, pullbackU)

  const b = galleryPlayBounds(sim)
  const tSteer = timingSteerForBoard(timingErrorSec)

  /**
   * Timing steers a concrete aim spot on the wheel (early/late = sides, quality = row height).
   * Player sees cause → effect like barrel meeting pitch, not a hidden lottery vector.
   */
  const aimTx = b.cx + tSteer * b.halfW * 0.9
  const verticalFrac = clamp(
    0.2 + 0.48 * (1 - quality) - 0.07 * sweetQu + tSteer * tSteer * 0.04,
    0.08,
    0.62
  )
  const aimTy = b.cy - b.halfH * verticalFrac

  const rdx = aimTx - fromX
  const rdy = aimTy - fromY
  const refAngle = Math.atan2(rdy, rdx)

  /** Sweet-spot steadies fine yaw; doesn’t erase timing steer (aim point already did the work). */
  const aimStiffness = 0.38 + 0.62 * sweetQu
  const trimYaw = tSteer * TIMING_YAW_MAX_RAD * aimStiffness

  /** Off-barrel: small deterministic wobble only when q is low. */
  const jitter =
    Math.sin(
      timingErrorSec * 103.417 + sweetQu * 27.913 + pullbackU * 8.771
    ) *
    OFF_BARREL_ANGLE_SCATTER_RAD *
    (1 - sweetQu)

  /** Pullback: power into the ball + a bit more sky when loaded. */
  const pu = clamp(pullbackU, 0, 1)
  const pullLoftRaw =
    (pu - 0.06) * PULLBACK_LOFT_MAX_RAD * (0.5 + 0.5 * sweetQu)
  const pullLoft = clamp(pullLoftRaw, -0.04, PULLBACK_LOFT_MAX_RAD * 0.88)

  const baseLoft =
    bucket === 'dribble' ? DRIBBLE_BASE_LOFT_RAD : FAIR_CONTACT_BASE_LOFT_RAD
  const baseAngle = refAngle + trimYaw + jitter + pullLoft + baseLoft

  let speed: number
  if (bucket === 'dribble') {
    const v0 =
      OUT_SPEED_DRIBBLE *
      (0.52 + 0.4 * quality) *
      (0.58 + 0.42 * pu) *
      (0.65 + 0.35 * sweetQu)
    speed = clamp(v0, 340, OUT_SPEED_MIN * 0.88)
  } else {
    const pullCore = Math.pow(pu, 0.62)
    const speedBand = OUT_SPEED_MIN + pullCore * (OUT_SPEED_MAX - OUT_SPEED_MIN)
    /** High floors so “I put a swing on it” always feels like baseball, not a dying lob. */
    const timingEff = 0.58 + 0.42 * quality
    const barrelEff = 0.72 + 0.28 * sweetQu
    speed = speedBand * timingEff * barrelEff
    speed = clamp(speed, 520, OUT_SPEED_MAX)
  }

  const exitBand = classifyExitRewardBand(pu, quality, sweetQu, bucket)
  const bon = exitBandBonuses(exitBand)
  const angle = baseAngle + bon.loftRad
  let speedOut = speed * bon.speedMul
  const maxSp =
    exitBand === 'moonshot'
      ? OUT_SPEED_MAX * 1.38
      : exitBand === 'power'
        ? OUT_SPEED_MAX * 1.16
        : exitBand === 'carry'
          ? OUT_SPEED_MAX * 1.05
          : OUT_SPEED_MAX
  speedOut = bucket === 'dribble' ? speed : clamp(speedOut, 420, maxSp)

  const vx = Math.cos(angle) * speedOut
  const vy = Math.sin(angle) * speedOut
  const aimDeg = (Math.atan2(vy, vx) * 180) / Math.PI
  let tier: PowerTier =
    bucket === 'dribble' || bucket === 'poor_early' || bucket === 'poor_late'
      ? 'normal'
      : powerTierFromContact(transfer, Math.abs(timingErrorSec))

  if (exitBand === 'moonshot' && bucket !== 'dribble') {
    if (
      Math.abs(timingErrorSec) <= TIMING_GOOD_SEC * 0.38 &&
      sweetQu >= 0.52 &&
      pu >= 0.78
    ) {
      tier = 'perfect_full_send'
    } else if (tier !== 'perfect_full_send') {
      tier = 'full_send'
    }
  } else if (exitBand === 'power' && tier === 'normal' && quality >= 0.62) {
    tier = 'strong'
  }

  return {
    vx,
    vy,
    bucket,
    tier,
    speed: speedOut,
    aimDeg,
    transferEff: transfer,
    exitBand,
    outgoingGravityMul: bon.gravityMul,
  }
}

/** If player released with current θ and power, seconds until bat crosses launch plane. */
function estCrossFromThetaAndPower(theta: number, p: number): number {
  const w = -(OMEGA_BASE + OMEGA_SCALE * p) * SWING_WHIP_MULT
  if (theta <= THETA_LAUNCH) return 0.035
  if (Math.abs(w) < 1e-5) return 0.12
  const dt = (THETA_LAUNCH - theta) / w
  return clamp(dt, 0.028, 0.42)
}

function estSecondsUntilLaunchCross(sim: Sim): number {
  if (sim.phase !== 'swing' || sim.theta <= THETA_LAUNCH) return 0.03
  const w = sim.omega
  if (Math.abs(w) < 1e-4) return 0.12
  const dt = (THETA_LAUNCH - sim.theta) / w
  return clamp(dt, 0.02, 0.45)
}

function predictNextBatCrossTime(sim: Sim): number | null {
  if (sim.batCrossLaunchTime != null) return sim.batCrossLaunchTime
  if (sim.phase === 'charging') {
    return sim.simTime + estCrossFromThetaAndPower(sim.theta, sim.pCurrent)
  }
  if (sim.phase === 'swing') {
    return sim.simTime + estSecondsUntilLaunchCross(sim)
  }
  return null
}

/** timingError = batCross − idealBallArrival (negative = early barrel). */
function predictTimingErrorForPreview(sim: Sim): number | null {
  if (sim.idealContactTime <= 0) return null
  const tBat = predictNextBatCrossTime(sim)
  if (tBat == null) return null
  return tBat - sim.idealContactTime
}

function computePitchHud(sim: Sim): PitchHudState {
  if (sim.debugContactFlash > 0) return 'contact'
  if (sim.ballRole === 'outgoing') return 'outgoing'
  if (sim.ballRole === 'incoming') return 'incoming'
  if (sim.phase === 'charging' && sim.pointer) return 'armed'
  return 'idle'
}

const YAWED_RING_STYLES = [
  {
    g0: '#8a8a92',
    g1: '#a8a8b0',
    g2: '#787880',
    strokeO: '#2e3038',
    strokeI: '#5c5e68',
  },
  {
    g0: '#6e7580',
    g1: '#8e95a0',
    g2: '#5a6068',
    strokeO: '#252830',
    strokeI: '#4a5058',
  },
  {
    g0: '#585c68',
    g1: '#787c88',
    g2: '#484c58',
    strokeO: '#1c1e24',
    strokeI: '#454a55',
  },
] as const

const RING_TARGET_PALETTE = [
  {
    liveFill: 'rgba(120, 220, 255, 0.95)',
    liveStroke: 'rgba(40, 140, 200, 0.9)',
  },
  {
    liveFill: 'rgba(200, 230, 130, 0.95)',
    liveStroke: 'rgba(90, 130, 45, 0.9)',
  },
  {
    liveFill: 'rgba(210, 170, 255, 0.92)',
    liveStroke: 'rgba(110, 70, 170, 0.88)',
  },
] as const

/** One annulus; ringIndex picks tone (0 front … 2 back). */
function drawYawedAnnulus(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  sx: number,
  ROuter: number,
  RInner: number,
  ringIndex: number
): void {
  const rxO = sx * ROuter
  const ryO = ROuter
  const rxI = sx * RInner
  const ryI = RInner
  const st = YAWED_RING_STYLES[ringIndex] ?? YAWED_RING_STYLES[1]

  const g = ctx.createLinearGradient(cx - rxO, cy, cx + rxO, cy)
  g.addColorStop(0, st.g0)
  g.addColorStop(0.5, st.g1)
  g.addColorStop(1, st.g2)

  ctx.fillStyle = g
  ctx.beginPath()
  ctx.ellipse(cx, cy, rxO, ryO, 0, 0, Math.PI * 2)
  ctx.ellipse(cx, cy, rxI, ryI, 0, 0, Math.PI * 2, true)
  ctx.fill('evenodd')

  ctx.strokeStyle = st.strokeO
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.ellipse(cx, cy, rxO, ryO, 0, 0, Math.PI * 2)
  ctx.stroke()

  ctx.strokeStyle = st.strokeI
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.ellipse(cx, cy, rxI, ryI, 0, 0, Math.PI * 2)
  ctx.stroke()
}

function samplePreviewPoint(
  tipX: number,
  tipY: number,
  vx0: number,
  vy0: number,
  t: number,
  gravity = OUTGOING_GRAVITY
): { x: number; y: number } {
  return {
    x: tipX + vx0 * t,
    y: tipY + vy0 * t + 0.5 * gravity * t * t,
  }
}

/** Dotted arc = predicted batted path from timing-contact model (same as resolution at plate). */
function drawPostHitTrajectoryPreview(ctx: CanvasRenderingContext2D, sim: Sim): void {
  const err = predictTimingErrorForPreview(sim)
  if (err == null) return
  const pullbackU = sim.phase === 'charging' ? sim.pCurrent : sim.pRelease
  const ix = pitchPlannedContactPoint(sim)
  const sweetQ = sweetSpotQuFromT(sim.pitchContactFracT)
  const out = battedBallOutcome(sim, err, ix.x, ix.y, pullbackU, sweetQ)
  if (out.bucket === 'miss') return

  const vx0 = out.vx
  const vy0 = out.vy
  const gPreview = OUTGOING_GRAVITY * out.outgoingGravityMul
  const prevRgb =
    out.exitBand === 'moonshot'
      ? [255, 210, 90]
      : out.exitBand === 'power'
        ? [120, 230, 255]
        : [0, 210, 255]

  ctx.save()
  ctx.setLineDash([6, 5])
  let prev = { x: ix.x, y: ix.y }
  for (let k = 1; k <= PREVIEW_STEPS; k++) {
    const u = (k - 1) / Math.max(1, PREVIEW_STEPS - 1)
    const alpha = 0.9 * (1 - 0.88 * u) + 0.1
    const lw =
      (out.exitBand === 'moonshot'
        ? 5.2
        : out.exitBand === 'power'
          ? 4.1
          : 3.4) *
        (1 - 0.55 * u) +
      1.15
    const t = k * PREVIEW_DT
    const cur = samplePreviewPoint(ix.x, ix.y, vx0, vy0, t, gPreview)
    ctx.strokeStyle = `rgba(${prevRgb[0]}, ${prevRgb[1]}, ${prevRgb[2]}, ${alpha.toFixed(3)})`
    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.moveTo(prev.x, prev.y)
    ctx.lineTo(cur.x, cur.y)
    ctx.stroke()
    prev = cur
  }
  ctx.setLineDash([])
  ctx.restore()
}

/** Legal aim arc while charging (direction / angle range). */
function drawChargeWindowArcWhite(
  ctx: CanvasRenderingContext2D,
  sim: Sim
): void {
  const { pivot: p, batLen: L } = sim
  const steps = 40
  ctx.save()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)'
  ctx.lineWidth = 3
  ctx.beginPath()
  for (let i = 0; i <= steps; i++) {
    const u = i / steps
    const a = THETA_CHARGE_MIN + u * (THETA_CHARGE_MAX - THETA_CHARGE_MIN)
    const x = p.x + L * Math.cos(a)
    const y = p.y + L * Math.sin(a)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.restore()
}

function angularDiff(a: number, b: number): number {
  let d = a - b
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return Math.abs(d)
}

function chainDestroyNeighbors(
  sim: Sim,
  ringIdx: number,
  hitIndex: number,
  mult: number
): void {
  const ring = sim.rings[ringIdx]
  const aHit = ring.rotation + ring.slotAngles[hitIndex]
  for (let j = 0; j < ring.targetSlots.length; j++) {
    if (j === hitIndex || !ring.targetSlots[j].isActive) continue
    const aj = ring.rotation + ring.slotAngles[j]
    if (angularDiff(aHit, aj) <= CHAIN_ANGLE_RAD) {
      ring.targetSlots[j].wasTriggered = true
      ring.targetSlots[j].isActive = false
      sim.score += Math.floor(BASE_HIT_SCORE * mult)
    }
  }
}

function drawPowerBar(
  ctx: CanvasRenderingContext2D,
  sim: Sim,
  fillP: number,
  label: string,
  opts?: {
    fullSendLocked?: boolean
    perfectSendLocked?: boolean
    fullSendZoneLive?: boolean
    perfectSendZoneLive?: boolean
  }
): void {
  const barW = sim.batLen * 2.1
  const barH = 14
  const bx = sim.pivot.x - barW / 2
  const by = sim.pivot.y + sim.batLen * 0.42

  ctx.fillStyle = '#2a2a2a'
  ctx.strokeStyle = '#111'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.rect(bx, by, barW, barH)
  ctx.fill()
  ctx.stroke()

  if (opts?.perfectSendLocked || opts?.perfectSendZoneLive) {
    ctx.strokeStyle = 'rgba(255, 120, 60, 0.98)'
    ctx.lineWidth = opts?.perfectSendLocked ? 5 : 3
    ctx.strokeRect(bx - 4, by - 4, barW + 8, barH + 8)
  } else if (opts?.fullSendLocked || opts?.fullSendZoneLive) {
    ctx.strokeStyle = 'rgba(255, 215, 80, 0.92)'
    ctx.lineWidth = opts?.fullSendLocked ? 4 : 2
    ctx.strokeRect(bx - 3, by - 3, barW + 6, barH + 6)
  }

  const fp = clamp(fillP, 0, 1)
  if (fp > 0) {
    ctx.fillStyle = powerBarColor(fp)
    ctx.fillRect(bx + 3, by + 3, (barW - 6) * fp, barH - 6)
  }

  ctx.fillStyle = '#fff'
  ctx.font = 'bold 11px ui-monospace, monospace'
  ctx.fillText(`${label} ${fp.toFixed(2)}`, bx + barW + 8, by + barH - 2)

  if (opts?.perfectSendLocked) {
    ctx.fillStyle = 'rgba(255, 140, 80, 0.98)'
    ctx.font = 'bold 12px system-ui, sans-serif'
    ctx.fillText('PERFECT FULL SEND', bx, by - 8)
  } else if (opts?.fullSendLocked) {
    ctx.fillStyle = 'rgba(255, 230, 120, 0.95)'
    ctx.font = 'bold 12px system-ui, sans-serif'
    ctx.fillText('FULL SEND', bx, by - 8)
  } else if (opts?.perfectSendZoneLive) {
    ctx.fillStyle = 'rgba(255, 160, 90, 0.95)'
    ctx.font = 'bold 11px system-ui, sans-serif'
    ctx.fillText('perfect send zone', bx, by - 6)
  } else if (opts?.fullSendZoneLive) {
    ctx.fillStyle = 'rgba(255, 220, 100, 0.9)'
    ctx.font = 'bold 11px system-ui, sans-serif'
    ctx.fillText('full send zone', bx, by - 6)
  }
}

function drawReleaseFlash(ctx: CanvasRenderingContext2D, sim: Sim): void {
  if (sim.releaseFlashRemain <= 0 || !sim.releaseFlashTier) return
  const t =
    sim.releaseFlashTier === 'perfect_full_send'
      ? FLASH_PERFECT_SEND
      : FLASH_FULL_SEND
  const a = Math.min(1, sim.releaseFlashRemain / t)
  const { pivot: p, batLen: L } = sim
  const rad = L * 1.2
  const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad)
  if (sim.releaseFlashTier === 'perfect_full_send') {
    g.addColorStop(0, `rgba(255, 240, 200, ${0.55 * a})`)
    g.addColorStop(0.45, `rgba(255, 140, 60, ${0.35 * a})`)
    g.addColorStop(1, 'rgba(255, 80, 40, 0)')
  } else {
    g.addColorStop(0, `rgba(255, 255, 230, ${0.45 * a})`)
    g.addColorStop(0.5, `rgba(255, 200, 100, ${0.25 * a})`)
    g.addColorStop(1, 'rgba(255, 180, 80, 0)')
  }
  ctx.save()
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(p.x, p.y, rad, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawBallTrail(ctx: CanvasRenderingContext2D, sim: Sim): void {
  const tier = sim.ballShotTier
  const band = sim.ballExitBand
  let thick = 2
  if (band === 'moonshot') thick = 6.2
  else if (band === 'power') thick = 4.8
  else if (band === 'carry') thick = 3.2
  else
    thick = tier === 'perfect_full_send' ? 4 : tier === 'full_send' ? 3 : 2
  for (let i = sim.ballTrail.length - 1; i >= 0; i--) {
    const pt = sim.ballTrail[i]
    const u = i / Math.max(1, sim.ballTrail.length - 1)
    const alpha =
      band === 'moonshot'
        ? 0.18 + (1 - u) * 0.52
        : band === 'power'
          ? 0.15 + (1 - u) * 0.45
          : 0.12 + (1 - u) * 0.38
    if (band === 'moonshot') {
      ctx.fillStyle = `rgba(255, 200, 120, ${alpha})`
    } else if (band === 'power') {
      ctx.fillStyle = `rgba(255, 210, 140, ${alpha})`
    } else if (tier === 'perfect_full_send') {
      ctx.fillStyle = `rgba(255, 120, 60, ${alpha})`
    } else if (tier === 'full_send') {
      ctx.fillStyle = `rgba(255, 200, 100, ${alpha})`
    } else {
      ctx.fillStyle = `rgba(180, 200, 220, ${alpha * 0.7})`
    }
    ctx.beginPath()
    ctx.arc(pt.x, pt.y, thick * (0.4 + 0.6 * (1 - u)), 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawDebugOverlay(ctx: CanvasRenderingContext2D, sim: Sim): void {
  const { pivot: p, batLen: L } = sim
  const tip = batTip(p, L, sim.theta)
  const thetaVisDeg = (sim.theta * 180) / Math.PI
  const ix = pitchPlannedContactPoint(sim)
  const predVel = sim.debugPredictedPostHitVel
  const predMag = predVel != null ? Math.hypot(predVel.x, predVel.y) : 0
  const predDir =
    predVel != null && predMag > 1e-3
      ? { x: predVel.x / predMag, y: predVel.y / predMag }
      : sim.debugLaunchDir

  const segs = 64
  const strokeArc = (
    theta0: number,
    theta1: number,
    color: string,
    width: number
  ) => {
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.beginPath()
    const steps = Math.max(
      8,
      Math.ceil((Math.abs(theta1 - theta0) / Math.PI) * segs)
    )
    for (let i = 0; i <= steps; i++) {
      const u = i / steps
      const a = theta0 + u * (theta1 - theta0)
      const x = p.x + L * Math.cos(a)
      const y = p.y + L * Math.sin(a)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }

  ctx.save()
  strokeArc(THETA_LEFT, THETA_RIGHT, 'rgba(100,100,100,0.35)', 2)
  strokeArc(THETA_CHARGE_MIN, THETA_CHARGE_MAX, 'rgba(0, 220, 120, 0.9)', 5)

  ctx.fillStyle = '#0af'
  ctx.beginPath()
  ctx.arc(p.x, p.y, 6, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#fa0'
  ctx.beginPath()
  ctx.arc(tip.x, tip.y, 5, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = 'rgba(0, 255, 200, 0.45)'
  ctx.lineWidth = 1.5
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.arc(ix.x, ix.y, CONTACT_ZONE_R, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([])

  ctx.fillStyle = 'rgba(255, 220, 80, 0.9)'
  ctx.beginPath()
  ctx.arc(ix.x, ix.y, 4, 0, Math.PI * 2)
  ctx.fill()

  const barLo = batPointAlong(p, L, THETA_LAUNCH, PITCH_CONTACT_FR_MIN)
  const barHi = batPointAlong(p, L, THETA_LAUNCH, PITCH_CONTACT_FR_MAX)
  const swPt = batPointAlong(p, L, THETA_LAUNCH, SWEET_SPOT_T)
  ctx.strokeStyle = 'rgba(255, 200, 120, 0.65)'
  ctx.lineWidth = 5
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(barLo.x, barLo.y)
  ctx.lineTo(barHi.x, barHi.y)
  ctx.stroke()
  ctx.fillStyle = 'rgba(120, 255, 180, 0.95)'
  ctx.beginPath()
  ctx.arc(swPt.x, swPt.y, 5, 0, Math.PI * 2)
  ctx.fill()

  const arrowLen = L * 0.5
  ctx.strokeStyle = '#0f0'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(ix.x, ix.y)
  ctx.lineTo(ix.x + predDir.x * arrowLen, ix.y + predDir.y * arrowLen)
  ctx.stroke()

  ctx.strokeStyle = 'rgba(255, 100, 255, 0.75)'
  ctx.lineWidth = 1.5
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  ctx.moveTo(tip.x, tip.y)
  ctx.lineTo(
    tip.x + Math.cos(sim.theta) * arrowLen * 0.75,
    tip.y + Math.sin(sim.theta) * arrowLen * 0.75
  )
  ctx.stroke()
  ctx.setLineDash([])

  if (sim.ball) {
    const bv = Math.hypot(sim.ball.vx, sim.ball.vy) || 1
    const nx = sim.ball.vx / bv
    const ny = sim.ball.vy / bv
    ctx.strokeStyle = '#f0f'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(sim.ball.x, sim.ball.y)
    ctx.lineTo(sim.ball.x + nx * 90, sim.ball.y + ny * 90)
    ctx.stroke()
  }

  const fLive = powerToSpeedFactor(sim.pCurrent)
  const fRel = powerToSpeedFactor(sim.pRelease)
  const ballSp =
    sim.ball != null
      ? Math.hypot(sim.ball.vx, sim.ball.vy).toFixed(0)
      : '—'
  const pred = sim.debugPredictedPostHitVel
  const predStr =
    pred != null
      ? `(${pred.x.toFixed(0)}, ${pred.y.toFixed(0)})`
      : '—'
  const inc = sim.debugIncomingVel
  const incStr =
    inc != null ? `(${inc.x.toFixed(0)}, ${inc.y.toFixed(0)})` : '—'
  const outDbg = sim.debugOutgoingVel
  const outStr =
    outDbg != null ? `(${outDbg.x.toFixed(0)}, ${outDbg.y.toFixed(0)})` : '—'
  const cp = sim.debugContactPoint
  const cpStr =
    cp != null ? `(${cp.x.toFixed(0)}, ${cp.y.toFixed(0)})` : '—'

  const idealStr =
    sim.idealContactTime > 0 ? sim.idealContactTime.toFixed(3) : '—'
  const swingStr =
    sim.debugSwingCrossTime != null
      ? sim.debugSwingCrossTime.toFixed(3)
      : '—'
  const terrStr =
    sim.debugTimingErrorSec != null
      ? `${(sim.debugTimingErrorSec * 1000).toFixed(0)}ms`
      : '—'
  const predErrStr =
    sim.debugPredictedTimingErrorSec != null
      ? `${(sim.debugPredictedTimingErrorSec * 1000).toFixed(0)}ms`
      : '—'
  const steerPred =
    sim.debugPredictedTimingErrorSec != null
      ? timingSteerForBoard(sim.debugPredictedTimingErrorSec)
      : null
  const steerLive =
    sim.debugTimingErrorSec != null
      ? timingSteerForBoard(sim.debugTimingErrorSec)
      : null
  const steerStr =
    steerPred != null
      ? `pred ${steerPred.toFixed(2)}`
      : steerLive != null
        ? `live ${steerLive.toFixed(2)}`
        : '—'

  const batRec =
    sim.phase === 'recovery'
      ? sim.recoverySettling
        ? 'settle'
        : 'cruise'
      : '—'
  const lines = [
    `pitch: ${sim.debugPitchHud}  ballRole: ${sim.ballRole}  arm: ${sim.pitchArmElapsed.toFixed(2)}s  auto:${sim.debugAutoPitch ? 'Y' : 'n'}`,
    `pitch v: ${sim.pitchSpeedNominal.toFixed(0)}  incoming ay: ${sim.pitchIncomingAy.toFixed(0)}  frT: ${sim.pitchContactFracT.toFixed(2)}  relDy: ${sim.pitchReleaseDyPx.toFixed(1)}`,
    `sweetQ prev: ${sim.debugSweetQPreview.toFixed(2)}  @hit: ${sim.debugSweetQAtContact.toFixed(2)}  batT: ${sim.debugContactAlongT.toFixed(2)}`,
    `xfer: ${sim.debugTransferEff.toFixed(2)}  pullU@hit: ${sim.debugPullbackUAtContact.toFixed(2)}  idle: ${sim.idleAutoPitchAccum.toFixed(2)}s`,
    `exit prev: ${sim.debugExitBandPreview}  last: ${sim.debugLastExitBand}  g×: ${sim.ballOutgoingGravityMul.toFixed(2)}`,
    `idealContactT: ${idealStr}  swingCrossT: ${swingStr}  simT: ${sim.simTime.toFixed(3)}`,
    `timingErr: ${terrStr}  predErr: ${predErrStr}  steer: ${steerStr}  bucket: ${sim.debugContactBucket}`,
    `launch θ: ${sim.debugLaunchAngleDeg.toFixed(1)}°  speed: ${sim.debugLaunchSpeed.toFixed(0)}`,
    `preview≈hit: ${sim.debugPreviewMatchesActual ? 'yes' : 'no'}  contact: ${cpStr}`,
    `pred v0: ${predStr}  incoming v: ${incStr}  outgoing v@hit: ${outStr}`,
    `phase: ${sim.phase}  batRec: ${batRec}  lock: ${sim.swingGrabLockoutRemain.toFixed(2)}s`,
    `bat θ: ${((sim.theta * 180) / Math.PI).toFixed(1)}°  ω: ${sim.omega.toFixed(2)}  intr: ${sim.batInterruptFlashRemain > 0 ? 'yes' : 'no'}`,
    `θ visual (bat): ${thetaVisDeg.toFixed(1)}°`,
    `p (live): ${sim.pCurrent.toFixed(2)}  f(p): ${fLive.toFixed(3)}`,
    `p_release: ${sim.pRelease.toFixed(2)}  f(p): ${fRel.toFixed(3)}`,
    `|ball|: ${ballSp}  batted v (pred HUD): ${
      predVel != null
        ? `(${predVel.x.toFixed(0)}, ${predVel.y.toFixed(0)})`
        : '(—, —)'
    }`,
    `g_in: ${GRAVITY}  g_out: ${OUTGOING_GRAVITY}`,
    `release tier: ${sim.powerTierRelease}  mult: x${scoreMultiplier(sim.powerTierRelease).toFixed(2)}`,
    `ball tier: ${sim.ball ? sim.ballShotTier : '—'}${sim.ball ? `  pierceArmed: ${sim.ballPierceArmed}` : ''}`,
    `charge t: ${sim.chargeElapsed.toFixed(2)}s`,
    sim.ball
      ? `ball v: (${sim.ball.vx.toFixed(0)}, ${sim.ball.vy.toFixed(0)})`
      : 'ball v: —',
    `disc exposed all hit: ${sim.debugAllTargetsTriggered}  (fixed occluder y)`,
    ...sim.rings.map((ring, r) => {
      const layer = r === 0 ? 'front' : r === 1 ? 'mid' : 'back'
      const dir = ring.omega >= 0 ? 'CW' : 'CCW'
      return `ring ${r} (${layer}): ${dir}  ω=${ring.omega.toFixed(2)}  θ=${ring.rotation.toFixed(3)}`
    }),
  ]

  ctx.font = '12px ui-monospace, monospace'
  ctx.fillStyle = 'rgba(0,0,0,0.82)'
  const pad = 8
  const lh = 14
  const tw = Math.max(...lines.map((s) => ctx.measureText(s).width)) + pad * 2
  const th = lines.length * lh + pad * 2
  ctx.fillRect(8, 8, tw, th)
  ctx.fillStyle = '#eee'
  lines.forEach((line, i) => {
    ctx.fillText(line, 8 + pad, 8 + pad + (i + 1) * lh - 4)
  })
  ctx.restore()
}

/** Fire one pitch from mound toward the planned barrel contact point. */
function spawnIncomingPitch(sim: Sim, opts?: { auto?: boolean }): void {
  if (sim.ball != null) return
  sim.pitchSeq += 1
  pickPitchVariantParams(sim)
  sim.debugAutoPitch = opts?.auto ?? false

  const target = pitchPlannedContactPoint(sim)
  const start = {
    x: sim.w * PITCH_MOUND_X_FR,
    y: target.y + sim.pitchReleaseDyPx,
  }
  const dx = target.x - start.x
  const dy = target.y - start.y
  const len = Math.hypot(dx, dy) || 1
  const sp = sim.pitchSpeedNominal
  const vx = (dx / len) * sp
  const vy = (dy / len) * sp
  sim.ball = {
    x: start.x,
    y: start.y,
    vx,
    vy,
    r: BALL_R,
  }
  sim.ballRole = 'incoming'
  sim.ballShotTier = 'normal'
  sim.ballPierceArmed = false
  sim.ballExitBand = 'standard'
  sim.ballOutgoingGravityMul = 1
  sim.ballTrail = []
  const travelSec =
    Math.abs(vx) > 80 ? (target.x - start.x) / vx : len / sp
  sim.idealContactTime = sim.simTime + clamp(travelSec, 0.06, 1.35)
  sim.pitchContactResolved = false
  sim.batCrossLaunchTime = null
  sim.idleAutoPitchAccum = 0
}

function clearIncomingPitch(sim: Sim): void {
  if (sim.ballRole !== 'incoming') return
  sim.ball = null
  sim.ballTrail = []
  sim.ballRole = 'none'
  sim.idealContactTime = -1
  sim.pitchContactResolved = false
}

export function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const simRef = useRef<Sim | null>(null)
  const devDrawOptionsRef = useRef<DevDrawOptions>({
    clipDiscLowerHalf: false,
    revealHiddenLayers: true,
    showLauncherDebugHud: true,
  })

  const [devToolsOpen, setDevToolsOpen] = useState(false)
  const [clipDiscLowerHalf, setClipDiscLowerHalf] = useState(false)
  const [revealHiddenLayers, setRevealHiddenLayers] = useState(true)
  const [showLauncherDebugHud, setShowLauncherDebugHud] = useState(true)

  const resize = useCallback(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const vw = container.clientWidth
    const vh = container.clientHeight
    if (vw <= 0 || vh <= 0) return

    let w: number
    let h: number
    if (vw / vh > ASPECT) {
      h = vh
      w = h * ASPECT
    } else {
      w = vw
      h = w / ASPECT
    }

    const dpr = Math.min(window.devicePixelRatio ?? 1, 2)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)

    if (!simRef.current) {
      simRef.current = createSim(w, h)
    } else {
      layoutSim(simRef.current, w, h)
    }
    simRef.current.dpr = dpr
  }, [])

  useEffect(() => {
    resize()
    const ro = new ResizeObserver(() => resize())
    if (containerRef.current) ro.observe(containerRef.current)
    window.addEventListener('resize', resize)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', resize)
    }
  }, [resize])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const sim = simRef.current
    if (!canvas || !sim) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { w, h, dpr } = sim
    let sx = 0
    let sy = 0
    if (sim.shakeRemain > 0) {
      const m = 6.5 * (sim.shakeRemain / SHAKE_PERFECT)
      sx = (Math.random() - 0.5) * m * 2
      sy = (Math.random() - 0.5) * m * 2
    }
    ctx.setTransform(dpr, 0, 0, dpr, sx * dpr, sy * dpr)
    ctx.clearRect(-sx, -sy, w + Math.abs(sx) * 2, h + Math.abs(sy) * 2)

    drawReleaseFlash(ctx, sim)

    const dev = devDrawOptionsRef.current
    const clipWheel =
      dev.clipDiscLowerHalf && !dev.revealHiddenLayers

    const { rings } = sim
    const frontRing = rings[0]
    const hubR = frontRing.radiusInner * 0.4

    if (clipWheel) {
      for (let r = RING_COUNT - 1; r >= 0; r--) {
        const ring = rings[r]
        const { x: rcx, y: rcy } = ring.center
        ctx.save()
        clipToRegionAboveOccluderY(ctx, fixedOccluderScreenY(ring), sim.w)
        drawYawedAnnulus(
          ctx,
          rcx,
          rcy,
          DISC_SX,
          ring.radiusOuter,
          ring.radiusInner,
          r
        )
        drawRingRowTargets(ctx, ring, r, dev.revealHiddenLayers)
        ctx.restore()
      }
    } else {
      for (let r = RING_COUNT - 1; r >= 0; r--) {
        const ring = rings[r]
        const { x: rcx, y: rcy } = ring.center
        drawYawedAnnulus(
          ctx,
          rcx,
          rcy,
          DISC_SX,
          ring.radiusOuter,
          ring.radiusInner,
          r
        )
      }

      ctx.fillStyle = '#363640'
      ctx.beginPath()
      ctx.arc(frontRing.center.x, frontRing.center.y, hubR, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#1a1a20'
      ctx.lineWidth = 2
      ctx.stroke()

      if (dev.revealHiddenLayers) {
        for (let r = RING_COUNT - 1; r >= 0; r--) {
          const ring = rings[r]
          drawFixedOccluderEdgeDebug(ctx, ring)
        }
        drawGalleryRowCenterDebug(ctx, rings)
      }

      for (let r = RING_COUNT - 1; r >= 0; r--) {
        drawRingRowTargets(ctx, rings[r], r, dev.revealHiddenLayers)
      }
    }

    if (clipWheel) {
      ctx.fillStyle = '#363640'
      ctx.beginPath()
      ctx.arc(frontRing.center.x, frontRing.center.y, hubR, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#1a1a20'
      ctx.lineWidth = 2
      ctx.stroke()
      if (dev.revealHiddenLayers) {
        for (let r = RING_COUNT - 1; r >= 0; r--) {
          const ring = rings[r]
          drawFixedOccluderEdgeDebug(ctx, ring)
        }
        drawGalleryRowCenterDebug(ctx, rings)
      }
    }

    const showPostHitPreview =
      sim.idealContactTime > 0 &&
      predictTimingErrorForPreview(sim) != null &&
      ((sim.phase === 'charging' && sim.pointer) ||
        sim.phase === 'swing' ||
        sim.phase === 'recovery')

    if (sim.phase === 'charging' && sim.pointer) {
      drawChargeWindowArcWhite(ctx, sim)
    }
    if (showPostHitPreview) {
      drawPostHitTrajectoryPreview(ctx, sim)
    }

    const tip = batTip(sim.pivot, sim.batLen, sim.theta)
    ctx.strokeStyle = '#222'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(sim.pivot.x, sim.pivot.y)
    ctx.lineTo(tip.x, tip.y)
    ctx.stroke()

    if (sim.phase === 'charging') {
      const pz = isPerfectSendZone(sim.pCurrent)
      drawPowerBar(ctx, sim, sim.pCurrent, 'power', {
        fullSendZoneLive: isFullSendZone(sim.pCurrent) && !pz,
        perfectSendZoneLive: pz,
      })
    } else if (sim.phase === 'swing' || sim.phase === 'recovery') {
      drawPowerBar(ctx, sim, sim.pRelease, 'locked', {
        fullSendLocked: sim.powerTierRelease === 'full_send',
        perfectSendLocked: sim.powerTierRelease === 'perfect_full_send',
      })
    }

    if (sim.ball) {
      if (sim.ballRole === 'outgoing') {
        drawBallTrail(ctx, sim)
      }
      if (sim.ballRole === 'incoming') {
        ctx.fillStyle = '#f2e6d8'
        ctx.strokeStyle = 'rgba(200, 120, 60, 0.75)'
        ctx.lineWidth = 2
      } else if (
        sim.ballRole === 'outgoing' &&
        sim.ballExitBand === 'moonshot'
      ) {
        ctx.fillStyle = '#3a2416'
        ctx.strokeStyle = 'rgba(255, 235, 160, 0.98)'
        ctx.lineWidth = 3
      } else if (
        sim.ballRole === 'outgoing' &&
        sim.ballExitBand === 'power'
      ) {
        ctx.fillStyle = '#342818'
        ctx.strokeStyle = 'rgba(255, 200, 110, 0.9)'
        ctx.lineWidth = 2.5
      } else if (sim.ballShotTier === 'perfect_full_send') {
        ctx.fillStyle = '#3a2a22'
        ctx.strokeStyle = 'rgba(255, 120, 60, 0.85)'
        ctx.lineWidth = 2
      } else if (sim.ballShotTier === 'full_send') {
        ctx.fillStyle = '#2c2620'
        ctx.strokeStyle = 'rgba(255, 190, 90, 0.65)'
        ctx.lineWidth = 2
      } else {
        ctx.fillStyle = '#333'
      }
      ctx.beginPath()
      ctx.arc(sim.ball.x, sim.ball.y, sim.ball.r, 0, Math.PI * 2)
      ctx.fill()
      if (
        sim.ballRole === 'incoming' ||
        sim.ballExitBand === 'moonshot' ||
        sim.ballExitBand === 'power' ||
        sim.ballShotTier === 'full_send' ||
        sim.ballShotTier === 'perfect_full_send'
      ) {
        ctx.stroke()
      }
      if (sim.ballRole === 'outgoing' && sim.ballExitBand === 'moonshot') {
        ctx.save()
        ctx.font = 'bold 11px system-ui, sans-serif'
        ctx.fillStyle = 'rgba(255, 230, 150, 0.98)'
        ctx.fillText('MOONSHOT', sim.ball.x - 34, sim.ball.y - sim.ball.r - 8)
        ctx.restore()
      } else if (sim.ballRole === 'outgoing' && sim.ballExitBand === 'power') {
        ctx.save()
        ctx.font = 'bold 10px system-ui, sans-serif'
        ctx.fillStyle = 'rgba(255, 210, 130, 0.95)'
        ctx.fillText('POWER', sim.ball.x - 22, sim.ball.y - sim.ball.r - 7)
        ctx.restore()
      } else if (
        sim.ballRole === 'outgoing' &&
        sim.ballShotTier === 'perfect_full_send'
      ) {
        ctx.save()
        ctx.font = 'bold 10px system-ui, sans-serif'
        ctx.fillStyle = 'rgba(255, 160, 90, 0.95)'
        ctx.fillText('PERFECT SEND', sim.ball.x - 38, sim.ball.y - sim.ball.r - 6)
        ctx.restore()
      } else if (
        sim.ballRole === 'outgoing' &&
        sim.ballShotTier === 'full_send'
      ) {
        ctx.save()
        ctx.font = 'bold 10px system-ui, sans-serif'
        ctx.fillStyle = 'rgba(255, 210, 120, 0.9)'
        ctx.fillText('FULL SEND', sim.ball.x - 28, sim.ball.y - sim.ball.r - 6)
        ctx.restore()
      }
    }

    ctx.font = 'bold 16px ui-monospace, monospace'
    ctx.fillStyle = 'rgba(255,255,255,0.92)'
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'
    ctx.lineWidth = 3
    const scoreText = `score ${sim.score}`
    const sw = ctx.measureText(scoreText).width
    ctx.strokeText(scoreText, w - 12 - sw, 28)
    ctx.fillText(scoreText, w - 12 - sw, 28)

    if (devDrawOptionsRef.current.showLauncherDebugHud) {
      drawDebugOverlay(ctx, sim)
    }
  }, [])

  useLayoutEffect(() => {
    devDrawOptionsRef.current = {
      clipDiscLowerHalf,
      revealHiddenLayers,
      showLauncherDebugHud,
    }
    const sim = simRef.current
    const canvas = canvasRef.current
    if (sim && canvas) draw()
  }, [
    clipDiscLowerHalf,
    revealHiddenLayers,
    showLauncherDebugHud,
    draw,
  ])

  useGameLoop((dt) => {
    const sim = simRef.current
    if (!sim) return

    sim.simTime += dt

    // Sim is game state in a ref; ring.rotation updates each tick (not React state).
    for (let ri = 0; ri < RING_COUNT; ri++) {
      const ring = sim.rings[ri]
      ring.rotation += ring.omega * dt
    }
    sim.prevTheta = sim.theta

    updateDiscTargetStates(sim)

    if (sim.releaseFlashRemain > 0) {
      sim.releaseFlashRemain = Math.max(0, sim.releaseFlashRemain - dt)
      if (sim.releaseFlashRemain <= 0) sim.releaseFlashTier = null
    }
    if (sim.shakeRemain > 0) {
      sim.shakeRemain = Math.max(0, sim.shakeRemain - dt)
    }
    if (sim.batInterruptFlashRemain > 0) {
      sim.batInterruptFlashRemain = Math.max(0, sim.batInterruptFlashRemain - dt)
    }
    sim.debugContactFlash = Math.max(0, sim.debugContactFlash - dt)

    if (sim.phase === 'charging' && sim.pointer) {
      sim.chargeElapsed += dt
      sim.theta = thetaChargeFromPointer(
        sim.pivot.x,
        sim.pivot.y,
        sim.pointer
      )
      sim.pCurrent = pullbackNormalizedFromVisualTheta(sim.theta)
      sim.omega = 0
      sim.idleAutoPitchAccum = 0
      sim.pitchArmElapsed += dt
      if (
        sim.ball == null &&
        sim.pitchArmElapsed >= PITCH_ARM_DELAY_SEC
      ) {
        spawnIncomingPitch(sim)
      }
    } else if (sim.phase === 'swing') {
      sim.swingGrabLockoutRemain = Math.max(0, sim.swingGrabLockoutRemain - dt)
      sim.theta += sim.omega * dt
      sim.omega *= Math.exp(-SWING_DAMPING * dt)

      if (
        !sim.swingCrossedLaunch &&
        sim.prevTheta > THETA_LAUNCH &&
        sim.theta <= THETA_LAUNCH
      ) {
        sim.swingCrossedLaunch = true
        sim.batCrossLaunchTime = sim.simTime
        sim.phase = 'recovery'
        sim.recoveryTargetTheta = sim.theta - TWO_PI
        sim.recoverySettling = false
        sim.swingGrabLockoutRemain = 0
        sim.omega *= RECOVERY_OMEGA_CARRY
      }
    } else if (sim.phase === 'recovery') {
      if (sim.recoverySettling) {
        sim.omega += SETTLE_SPRING_K * (THETA_REST - sim.theta) * dt
        sim.omega *= Math.exp(-SETTLE_OMEGA_DRAG * dt)
        sim.theta += sim.omega * dt
        if (
          Math.abs(sim.theta - THETA_REST) < SETTLE_SNAP_ANGLE &&
          Math.abs(sim.omega) < SETTLE_SNAP_OMEGA
        ) {
          sim.phase = 'idle'
          sim.theta = THETA_REST
          sim.omega = 0
          sim.swingCrossedLaunch = false
          sim.recoverySettling = false
          sim.chargeElapsed = 0
          sim.pCurrent = 0
          sim.pRelease = 0
        }
      } else {
        sim.theta += sim.omega * dt
        sim.omega *= Math.exp(-RECOVERY_DAMPING * dt)
        if (sim.theta <= sim.recoveryTargetTheta) {
          sim.recoverySettling = true
          sim.theta = THETA_REST
          sim.omega = SETTLE_BOUNCE_OMEGA
        }
      }
    } else if (sim.phase === 'idle') {
      sim.theta = THETA_REST
      sim.omega = 0
      sim.chargeElapsed = 0
      sim.pCurrent = 0
    }

    const idleAutoOk =
      sim.phase === 'idle' &&
      sim.ball == null &&
      sim.pointer == null
    if (idleAutoOk) {
      sim.idleAutoPitchAccum += dt
      if (sim.idleAutoPitchAccum >= AUTO_PITCH_IDLE_SEC) {
        spawnIncomingPitch(sim, { auto: true })
      }
    } else {
      sim.idleAutoPitchAccum = 0
    }

    const errPred = predictTimingErrorForPreview(sim)
    if (
      errPred != null &&
      ((sim.phase === 'charging' && sim.pointer) ||
        sim.phase === 'swing' ||
        sim.phase === 'recovery')
    ) {
      const pullbackU = sim.phase === 'charging' ? sim.pCurrent : sim.pRelease
      const ixPrev = pitchPlannedContactPoint(sim)
      const sweetPrev = sweetSpotQuFromT(sim.pitchContactFracT)
      sim.debugSweetQPreview = sweetPrev
      const outPrev = battedBallOutcome(
        sim,
        errPred,
        ixPrev.x,
        ixPrev.y,
        pullbackU,
        sweetPrev
      )
      sim.debugExitBandPreview = outPrev.exitBand
      sim.debugPredictedTimingErrorSec = errPred
      if (outPrev.bucket === 'miss') {
        sim.debugPredictedPostHitVel = null
      } else {
        sim.debugPredictedPostHitVel = { x: outPrev.vx, y: outPrev.vy }
      }
    } else {
      sim.debugPredictedPostHitVel = null
      sim.debugPredictedTimingErrorSec = null
      sim.debugSweetQPreview = 0
      sim.debugExitBandPreview = 'standard'
    }

    sim.debugPreviewMatchesActual = false
    sim.debugPitchHud = computePitchHud(sim)

    const b = sim.ball
    if (b) {
      if (sim.ballRole === 'incoming') {
        b.vy += sim.pitchIncomingAy * dt
        b.x += b.vx * dt
        b.y += b.vy * dt
        sim.debugIncomingVel = { x: b.vx, y: b.vy }
      } else {
        sim.debugIncomingVel = null
        integrateBall(
          b,
          OUTGOING_GRAVITY * sim.ballOutgoingGravityMul,
          dt
        )
      }

      if (sim.ballRole === 'incoming' && !sim.pitchContactResolved) {
        const ix = pitchPlannedContactPoint(sim)
        const tipL = batTip(sim.pivot, sim.batLen, THETA_LAUNCH)
        const d2 = distSqPointSegment(
          b.x,
          b.y,
          sim.pivot.x,
          sim.pivot.y,
          tipL.x,
          tipL.y
        )
        const tAlong = closestTOnBat(
          b.x,
          b.y,
          sim.pivot,
          sim.batLen,
          THETA_LAUNCH
        )
        const inUpperBarrel = tAlong >= 0.46
        const inZone =
          d2 <= CONTACT_ZONE_R * CONTACT_ZONE_R && inUpperBarrel
        const pastPlate = b.x > ix.x + BALL_PAST_PLATE_DX && b.vx > 40
        const swingOk =
          (sim.phase === 'swing' || sim.phase === 'recovery') &&
          sim.pRelease > POWER_DEADZONE &&
          sim.idealContactTime > 0

        if (inZone && swingOk && sim.batCrossLaunchTime != null) {
          sim.pitchContactResolved = true
          const err = sim.batCrossLaunchTime - sim.idealContactTime
          sim.debugTimingErrorSec = err
          sim.debugSwingCrossTime = sim.batCrossLaunchTime

          const sweetHit = sweetSpotQuFromT(tAlong)
          sim.debugContactAlongT = tAlong
          sim.debugSweetQAtContact = sweetHit
          sim.debugPullbackUAtContact = sim.pRelease
          const out = battedBallOutcome(
            sim,
            err,
            ix.x,
            ix.y,
            sim.pRelease,
            sweetHit
          )
          sim.debugTransferEff = out.transferEff
          sim.debugContactBucket = out.bucket
          sim.debugLaunchSpeed = out.speed
          sim.debugLaunchAngleDeg = out.aimDeg
          const spn = out.speed > 1e-3 ? out.speed : 1
          sim.debugLaunchDir = { x: out.vx / spn, y: out.vy / spn }

          if (out.bucket !== 'miss') {
            b.vx = out.vx
            b.vy = out.vy
            sim.ballRole = 'outgoing'
            sim.ballShotTier = out.tier
            sim.ballPierceArmed = out.tier === 'perfect_full_send'
            sim.ballExitBand = out.exitBand
            sim.ballOutgoingGravityMul = out.outgoingGravityMul
            sim.debugLastExitBand = out.exitBand
            sim.ballTrail = []
            sim.debugContactPoint = { x: b.x, y: b.y }
            if (out.exitBand === 'moonshot') {
              sim.debugContactFlash = 0.36
              sim.shakeRemain = Math.max(sim.shakeRemain, SHAKE_PERFECT * 0.48)
            } else if (out.exitBand === 'power') {
              sim.debugContactFlash = 0.24
              sim.shakeRemain = Math.max(sim.shakeRemain, SHAKE_PERFECT * 0.22)
            } else if (out.exitBand === 'carry') {
              sim.debugContactFlash = 0.15
            } else {
              sim.debugContactFlash = 0.12
            }
            sim.debugOutgoingVel = { x: out.vx, y: out.vy }
            const cmp = sim.debugPredictedPostHitVel
            const predE = sim.debugPredictedTimingErrorSec
            sim.debugPreviewMatchesActual =
              cmp != null &&
              predE != null &&
              Math.abs(predE - err) < 0.04 &&
              Math.hypot(cmp.x - out.vx, cmp.y - out.vy) < 55
          } else {
            sim.debugContactFlash = 0.06
            sim.debugOutgoingVel = null
          }
        } else if (pastPlate) {
          sim.pitchContactResolved = true
          sim.debugContactBucket = 'miss'
          sim.debugTimingErrorSec = null
          sim.ball = null
          sim.ballTrail = []
          sim.ballRole = 'none'
          sim.idealContactTime = -1
        }
      }

      if (sim.ballRole === 'outgoing') {
        sim.ballTrail.unshift({ x: b.x, y: b.y })
        if (sim.ballTrail.length > TRAIL_MAX) {
          sim.ballTrail.length = TRAIL_MAX
        }
      }

      if (sim.ballRole === 'incoming') {
        const oob =
          b.x < -BALL_R * 2 ||
          b.x > sim.w + BALL_R * 2 ||
          b.y < -BALL_R * 2 ||
          b.y > sim.h + BALL_R * 2
        if (oob) {
          sim.ball = null
          sim.ballTrail = []
          sim.ballRole = 'none'
          sim.idealContactTime = -1
        }
      }

      let hitRing = -1
      let hitIdx = -1
      if (sim.ballRole === 'outgoing') {
        for (let r = 0; r < RING_COUNT; r++) {
          const ring = sim.rings[r]
          const Rmid = ringMidFromDiscRing(ring)
          for (let i = 0; i < ring.targetSlots.length; i++) {
            const a = ring.rotation + ring.slotAngles[i]
            const inExposed = targetIsExposedAboveOccluder(ring, Rmid, a)
            if (!ring.targetSlots[i].isActive || !inExposed) continue
            const tp = ringScreenPoint(
              ring.center.x,
              ring.center.y,
              DISC_SX,
              Rmid,
              a
            )
            if (circlesOverlap(b.x, b.y, b.r, tp.x, tp.y, TARGET_R)) {
              hitRing = r
              hitIdx = i
              break
            }
          }
          if (hitRing >= 0) break
        }
      }

      if (hitRing >= 0 && hitIdx >= 0) {
        const tier = sim.ballShotTier
        const mult = scoreMultiplier(tier)
        sim.score += Math.floor(BASE_HIT_SCORE * mult)

        const struck = sim.rings[hitRing].targetSlots[hitIdx]
        struck.wasTriggered = true
        struck.isActive = false

        if (tier === 'perfect_full_send' && sim.ballPierceArmed) {
          sim.ballPierceArmed = false
          b.vx *= PIERCE_SPEED_MUL
          b.vy *= PIERCE_SPEED_MUL
          console.log('hit (pierce — perfect full send)')
        } else if (tier === 'full_send') {
          chainDestroyNeighbors(sim, hitRing, hitIdx, mult)
          sim.ball = null
          sim.ballTrail = []
          sim.ballRole = 'none'
          sim.idealContactTime = -1
          console.log('hit (full send + chain)')
        } else {
          sim.ball = null
          sim.ballTrail = []
          sim.ballRole = 'none'
          sim.idealContactTime = -1
          console.log('hit')
        }
        refreshTargetActiveFlags(sim)
      } else if (
        sim.ballRole === 'outgoing' &&
        (b.x < -BALL_R * 2 ||
          b.x > sim.w + BALL_R * 2 ||
          b.y < -BALL_R * 2 ||
          b.y > sim.h + BALL_R * 2)
      ) {
        sim.ball = null
        sim.ballTrail = []
        sim.ballRole = 'none'
        sim.idealContactTime = -1
      }
    }

    if (sim.ball == null) {
      sim.ballOutgoingGravityMul = 1
      sim.ballExitBand = 'standard'
    }

    draw()
  })

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const sim = simRef.current
    const canvas = canvasRef.current
    if (!sim || !canvas) return

    sim.pointer = pointerToLogical(
      e.clientX,
      e.clientY,
      canvas.getBoundingClientRect(),
      sim
    )

    const grabOk =
      nearBat(sim) &&
      (sim.phase === 'idle' ||
        (sim.phase === 'swing' &&
          sim.swingGrabLockoutRemain <= 0) ||
        sim.phase === 'recovery')
    if (grabOk) {
      if (sim.phase === 'swing' || sim.phase === 'recovery') {
        sim.batInterruptFlashRemain = 0.45
        console.log('bat: grab overrides', sim.phase)
      }
      sim.phase = 'charging'
      sim.recoverySettling = false
      sim.chargeElapsed = 0
      sim.theta = thetaChargeFromPointer(
        sim.pivot.x,
        sim.pivot.y,
        sim.pointer
      )
      sim.pCurrent = pullbackNormalizedFromVisualTheta(sim.theta)
      sim.omega = 0
      sim.pitchArmElapsed = 0
      sim.batCrossLaunchTime = null
    }
    draw()
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const sim = simRef.current
    const canvas = canvasRef.current
    if (!sim || !canvas) return
    sim.pointer = pointerToLogical(
      e.clientX,
      e.clientY,
      canvas.getBoundingClientRect(),
      sim
    )
    draw()
  }

  const endCharge = (sim: Sim) => {
    if (sim.phase !== 'charging') return

    sim.pRelease = sim.pCurrent
    sim.thetaRelease = sim.theta

    if (sim.pRelease < POWER_DEADZONE) {
      sim.phase = 'idle'
      sim.theta = THETA_REST
      sim.omega = 0
      sim.chargeElapsed = 0
      sim.pCurrent = 0
      sim.pRelease = 0
      sim.powerTierRelease = 'normal'
      sim.releaseFlashTier = null
      sim.releaseFlashRemain = 0
      clearIncomingPitch(sim)
      sim.pitchArmElapsed = 0
    } else {
      sim.powerTierRelease = classifyPowerTier(sim.pRelease)
      const tr = sim.powerTierRelease
      if (tr === 'full_send' || tr === 'perfect_full_send') {
        sim.releaseFlashTier = tr
        sim.releaseFlashRemain =
          tr === 'perfect_full_send' ? FLASH_PERFECT_SEND : FLASH_FULL_SEND
      }
      if (tr === 'perfect_full_send') {
        sim.shakeRemain = SHAKE_PERFECT
      }
      sim.phase = 'swing'
      sim.theta = sim.thetaRelease
      sim.omega =
        -(OMEGA_BASE + OMEGA_SCALE * sim.pRelease) * SWING_WHIP_MULT
      sim.swingCrossedLaunch = false
      sim.swingGrabLockoutRemain = SWING_GRAB_LOCKOUT_SEC
      sim.recoverySettling = false
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const sim = simRef.current
    if (!sim) return

    endCharge(sim)

    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    draw()
  }

  const onPointerLeave = () => {
    const sim = simRef.current
    if (!sim) return
    if (sim.phase === 'charging') {
      sim.phase = 'idle'
      sim.theta = THETA_REST
      sim.omega = 0
      sim.chargeElapsed = 0
      sim.pCurrent = 0
      sim.pRelease = 0
      sim.powerTierRelease = 'normal'
      sim.releaseFlashTier = null
      sim.releaseFlashRemain = 0
      clearIncomingPitch(sim)
      sim.pitchArmElapsed = 0
    }
    sim.pointer = null
    draw()
  }

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
        style={{ touchAction: 'none', display: 'block' }}
      />
      <div
        style={{
          position: 'absolute',
          left: 8,
          bottom: 8,
          zIndex: 10,
          fontFamily: 'ui-monospace, monospace',
          fontSize: 11,
          color: '#e8e8e8',
          userSelect: 'none',
        }}
      >
        <button
          type="button"
          onClick={() => setDevToolsOpen((o) => !o)}
          style={{
            cursor: 'pointer',
            padding: '4px 10px',
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.25)',
            background: 'rgba(20,22,28,0.92)',
            color: '#eee',
            font: 'inherit',
          }}
        >
          {devToolsOpen ? '▼ Dev tools' : '▶ Dev tools'}
        </button>
        {devToolsOpen && (
          <div
            style={{
              marginTop: 6,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(18,20,26,0.95)',
              maxWidth: 280,
              boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
            }}
          >
            <div
              style={{
                fontWeight: 600,
                marginBottom: 8,
                opacity: 0.95,
              }}
            >
              Visibility
            </div>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 6,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={clipDiscLowerHalf}
                onChange={(e) => setClipDiscLowerHalf(e.target.checked)}
              />
              Clip wheel to exposed region (fixed machine lip)
            </label>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 6,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={revealHiddenLayers}
                onChange={(e) => setRevealHiddenLayers(e.target.checked)}
              />
              Reveal hidden / debug layers
            </label>
            <div
              style={{
                fontSize: 10,
                opacity: 0.65,
                margin: '-2px 0 10px 22px',
                lineHeight: 1.35,
              }}
            >
              When on: full disc, fixed occluder line (does not rotate), peg
              LIVE/hit/off labels. Overrides clipping so you can see behind the
              lip.
            </div>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={showLauncherDebugHud}
                onChange={(e) => setShowLauncherDebugHud(e.target.checked)}
              />
              Show launcher debug HUD
            </label>
          </div>
        )}
      </div>
    </div>
  )
}
