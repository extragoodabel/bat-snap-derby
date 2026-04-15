import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { DISC_SX, ringScreenPoint } from './disc'
import {
  type Ball,
  batPointAlong,
  batTip,
  circlesOverlap,
  closestTOnBat,
  distSqPointSegment,
  distPointToUnitRay,
  integrateBall,
  segmentCircleEarliestHit,
  type Vec2,
} from './physics'
import { useGameLoop } from './useGameLoop'
import { drawSpring } from './drawSpring'
import {
  drawBackgroundImage,
  drawBatSprite,
  drawSpriteDebugOverlay,
  drawStatueSprite,
  loadGameSprites,
  computeSpriteLayout,
  getStadiumImageAspectRatio,
  STAGE_VOID_HEX,
  type LoadedGameSprites,
  type SpriteLayout,
} from './gameSprites'
import {
  drawAtmosphericBackGlow,
  drawBatSilhouetteHalo,
  drawHeroShimmer,
  drawStatueSilhouetteHalo,
} from './spriteGlow'
import {
  drawRetroScoreboard,
  getScoreboardScreenRect,
  SCOREBOARD_TIME_LIMIT_SEC,
  SCOREBOARD_TIMED_MODE,
  targetPointsForRing,
} from './scoreboard'
import {
  applyFloatingTargetHitsForBall,
  drawFloatingCloudLayer,
  initFloatingCloudLayer,
  updateFloatingCloudLayer,
  type CloudTarget,
  type ParachutePayload,
} from './cloudTargets'
import {
  BALL_PAST_PLATE_DX_DESIGN,
  BALL_R_DESIGN,
  computeSceneLayout,
  CONTACT_ZONE_R_DESIGN,
  designPx,
  DESIGN_REF_H,
  DESIGN_REF_W,
  GALLERY_RING_SHIFT_BACK_DESIGN,
  GALLERY_RING_SHIFT_MID_DESIGN,
  GALLERY_ROOT_OFFSET_Y_DESIGN,
  GRAB_THRESH_BASE_DESIGN,
  POWER_BAR_DROP_TOWARD_PIVOT_DESIGN,
  POWER_BAR_GAP_ABOVE_SWING_DESIGN,
  POWER_BAR_HEIGHT_DESIGN,
  POWER_BAR_LABEL_CLEARANCE_DESIGN,
  POWER_BAR_MIN_WIDTH_DESIGN,
  PITCH_MOUND_NUDGE_UP_DESIGN,
  type SceneLayout,
} from './sceneLayout'

/** Board aspect before bg-stadium loads (then replaced by the image’s width÷height). */
const FALLBACK_BOARD_ASPECT = 16 / 9

/** Logical canvas must leave room for cabinet chrome; totals must match `index.css` :root. */
function readPlayfieldFrameBudgetPx(): { x: number; y: number } {
  if (typeof document === 'undefined') return { x: 76, y: 79 }
  const cs = getComputedStyle(document.documentElement)
  const x =
    parseFloat(cs.getPropertyValue('--playfield-frame-total-x').trim()) || 76
  const y =
    parseFloat(cs.getPropertyValue('--playfield-frame-total-y').trim()) || 79
  return { x: Math.max(0, x), y: Math.max(0, y) }
}
const GRAVITY = 700
/** Batted balls only — keep moderate so balls don’t dive under the wheel. */
const OUTGOING_GRAVITY = 392
const RING_OMEGA = 0.55
/** Concentric rows: index 0 = front/smallest, 2 = back/largest. */
const RING_COUNT = 3
const RING_TARGET_COUNTS: [number, number, number] = [7, 7, 8]
/** Stretch scales with speed / this (px/s) for motion feel. */
const BALL_STRETCH_SPEED_REF = 720
const BALL_STRETCH_MAX = 0.48
/** Motion-blur streak samples behind the ball along −velocity. */
const BALL_MOTION_BLUR_STEPS = 5
/** Hit / draw radius for rim targets; scales with layout + canvas min side. */
function targetRadiusPx(sim: Sim): number {
  const m = Math.min(sim.w, sim.h)
  const s = sim.sceneLayout.scale
  return Math.max(12 * s, m * 0.0262)
}

function ballRadiusPx(sim: Sim): number {
  return Math.max(4.25, BALL_R_DESIGN * sim.sceneLayout.scale)
}

function contactZoneRadiusPx(sim: Sim): number {
  return CONTACT_ZONE_R_DESIGN * sim.sceneLayout.scale
}

/** Path-alignment: effPerp ÷ (expandedR × this) → pathAlign01 (debug / intuition). */
const HIT_PATH_CORRIDOR_MULT = 3.6
/** Penalize targets whose center lies behind the ray origin along flight (weak steals). */
const HIT_BEHIND_RAY_PENALTY = 0.24
/** Tiny tie-break: deeper ring slightly prefers winning when alignment matches (px-scale). */
const HIT_DEPTH_SORT_BIAS = 0.045
/** Radial gap between nested rings (fraction of min(w,h)); widened for clearer row separation. */
const DISC_RING_GAP_FR = 0.034
/** Global scale for all disc radii — main stage presence vs rest of scene. */
const DISC_LAYOUT_SCALE = 1.48
/** Extra left shift (px) for staggered rows; grows with larger layout. */
/** Deeper rows: more spread so each disc reads as its own layer. */
const GALLERY_DEPTH_STEP_X_FR = 0.036
const GALLERY_DEPTH_STEP_Y_FR = 0.044
/** Front row anchor; CY lower on screen = field sits nearer “eye level” with raised batter. */
const GALLERY_FRONT_CX_FR = 0.37
const GALLERY_FRONT_CY_FR = 0.685
/**
 * Extra downward shift for the whole gallery stack (logical canvas px, +Y = down).
 * Equivalent to raising `GALLERY_FRONT_CY_FR` by `this / h` each layout — applied only
 * inside `galleryFrontRowAnchorY` so rings, targets, hits, occluder, and aim bounds stay in sync.
 */
/**
 * With launcher debug HUD on: draw a line at the pre-offset anchor (`fraction × h` only)
 * so you can confirm the full stack dropped by `GALLERY_ROOT_OFFSET_Y_DESIGN` (via `designPx`).
 */
const GALLERY_DEBUG_GUIDE_PRE_SHIFT_Y = false

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

const CHAIN_ANGLE_RAD = 0.42
const PIERCE_SPEED_MUL = 0.62
const TRAIL_MAX = 22
const FLASH_FULL_SEND = 0.2
const FLASH_PERFECT_SEND = 0.34
const SHAKE_PERFECT = 0.22


/**
 * Continuous pitch stream: average seconds between mound releases (+ jitter).
 * Independent of bat pullback / phase.
 */
const PITCH_CADENCE_SEC = 0.88
const PITCH_CADENCE_JITTER_SEC = 0.2
/** Cap simultaneous incoming balls so the plate stays readable. */
const MAX_INCOMING_PITCHES = 3
/** Incoming pitch speed band (px/s); fast, batting-like. */
const PITCH_SPEED_MIN = 1260
const PITCH_SPEED_MAX = 1680
/** Small vertical accel on incoming ball only (shallow arc; not full gravity). */
const PITCH_INCOMING_AY_MIN = -140
const PITCH_INCOMING_AY_MAX = 120
/** Wide strike-height variety on the bat (t pivot→tip); bias upward in pickPitchVariantFields. */
const PITCH_CONTACT_FR_MIN = 0.48
const PITCH_CONTACT_FR_MAX = 0.97
/** Pitch origin: horizontal center of scene (mound). */
const PITCH_MOUND_X_FR = 0.5
/**
 * Pitch origin Y (fraction of h, top→down): center of lower 1/8 of screen
 * (band [7/8, 1] → midpoint 15/16).
 */
const PITCH_MOUND_Y_FR = 15 / 16
/** Logical px: move release point up (smaller Y) toward visible mound art. */
/**
 * Incoming ball radius multiplier at release (grows to 1.0 by ideal contact time).
 */
const PITCH_DEPTH_START_R_MUL = 0.32
/**
 * Incoming pitch aims along the launch bat but caps distance from pivot so the
 * target stays over the infield. Uncapped length from oversized sprite bats
 * pushed contact above the canvas.
 */
const PITCH_AIM_BAT_LEN_MAX_FR = 0.345
/** Tiny start Y vs target (px-ish via minDim); slight upward bias = ball approaches from above more. */
const PITCH_RELEASE_DY_FR = 0.014
const PITCH_RELEASE_DY_BIAS_FR = -0.0065
/** Sweet spot: upper-mid barrel (t along bat); radius as fraction of bat length. */
const SWEET_SPOT_T = 0.74
const SWEET_SPOT_RADIUS_FR = 0.28
/** Very forgiving plate reach — goal: more hits than empty swings. */
/** Allow lower barrel / “choked up” meets; still skips pure handle. */
const CONTACT_BARREL_T_MIN = 0.28
/**
 * Allow contact while the bat sweeps through this angular window around launch (rad).
 * Stops “one vertical instant” reads; early/late on the arc can still connect.
 */
const CONTACT_THETA_EARLY = THETA_LAUNCH + 0.78
const CONTACT_THETA_LATE = THETA_LAUNCH - 1.05
/** |now − ideal contact| below this paints the incoming ball / plate as “ripe”. */
const TIMING_RIPE_WINDOW_SEC = 0.12
/**
 * |timingError| ≤ PERFECT → best tier; ≤ GOOD → solid hit; ≤ POOR → weak; else dribble.
 * (No timing-only whiff: awful timing maps to dribble / very weak contact.)
 */
const TIMING_PERFECT_SEC = 0.056
const TIMING_GOOD_SEC = 0.17
const TIMING_POOR_SEC = 0.34
/** Outgoing exit-speed band (px/s); pullback sets band, timing/barrel trim — not stacked into mush. */
const OUT_SPEED_MIN = 920
const OUT_SPEED_MAX = 2480
const OUT_SPEED_DRIBBLE = 620
/** Fine trim on top of aim-point steering (sweet spot steadies the barrel). */
const TIMING_YAW_MAX_RAD = 0.52
/** Pullback loft scale (most power → speed; loft capped small). */
const PULLBACK_LOFT_MAX_RAD = 0.36
const PULLBACK_LOFT_STRENGTH = 0.3
/** Neutral launch biased up — combats chronically low refAngle from plate→board geometry. */
const FAIR_CONTACT_BASE_LOFT_RAD = 0.082
const DRIBBLE_BASE_LOFT_RAD = 0.052
/** Extra radians tilted into the disc band (all contacted balls; dribble gets a fraction). */
const PLAYFIELD_LAUNCH_BIAS_RAD = 0.048
const PLAYFIELD_LAUNCH_BIAS_DRIBBLE_MUL = 0.55
/** Imperfect-barrel yaw; kept moderate so variance doesn’t dump trajectories low. */
const OFF_BARREL_ANGLE_SCATTER_RAD = 0.22

/** Exit reward — slightly easier carry/power so more balls “play above” the lip. */
const EXIT_SCORE_MOONSHOT = 0.898
const EXIT_SCORE_POWER = 0.772
const EXIT_SCORE_CARRY = 0.628
/** Batter pivot; Y smaller fraction = higher on screen, aligned with lowered gallery. */
const BAT_PIVOT_X_FR = 0.875
const BAT_PIVOT_Y_FR = 0.635

/** Soft field contact shadow under hero (pivot space; light from upper-left). */
const GROUND_SHADOW_OFFSET_X = 18
const GROUND_SHADOW_OFFSET_Y = 28
const GROUND_SHADOW_W_FR = 1.22
const GROUND_SHADOW_H_FR = 0.26
/** Max width stretch from full pullback (subtle). */
const GROUND_SHADOW_PULLBACK_STRETCH = 0.048
/** Past this offset from plate X, pitch is gone (extra px = more time to connect). */

/** Minimum grab distance from bat segment (CSS px in logical canvas space). */
/** Extra half-width scales with bat length so fat/long sprite bats stay grabbable. */
const GRAB_THRESH_BATLEN_FR = 0.3
/** Floor from canvas size so large boards don’t feel stingy. */
const GRAB_THRESH_MIN_CANVAS_FR = 0.034
const RIM_INNER_FR = 0.82

type LauncherPhase = 'idle' | 'charging' | 'swing' | 'recovery'

type BallRole = 'none' | 'outgoing'

/**
 * One pitched ball in flight toward the plate (may coexist with other incoming
 * pitches and with one outgoing batted ball).
 */
type IncomingPitch = {
  ball: Ball
  idealContactTime: number
  pitchSpawnSimTime: number
  pitchContactResolved: boolean
  pitchContactFracT: number
  pitchSpeedNominal: number
  pitchIncomingAy: number
  pitchReleaseDyPx: number
  pitchSeq: number
}

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

type VerticalShotBand = 'LOW' | 'PLAYFIELD' | 'HIGH'

type OutcomeClass = 'ordinary' | 'strong' | 'elite'

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
  /** Populated when sprite assets load; drives pivot / batLen from art. */
  spriteLayout: SpriteLayout | null
  /** Three staggered rows in perspective; [0] front/smallest … [2] back/largest. */
  rings: DiscWheelRing[]
  /** True when every target in the exposed (above-occluder) region has wasTriggered (all rings). */
  debugAllTargetsTriggered: boolean
  ball: Ball | null
  /** Pitches currently flying toward the plate (not including outgoing batted ball). */
  incomingPitches: IncomingPitch[]
  /** Seconds until next cadence spawn attempt (continuous stream). */
  pitchNextIn: number

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
  /**
   * After a solid hit, the ball was already advanced this frame as incoming;
   * skip one outgoing `integrateBall` so we don’t double-integrate.
   */
  skipOutgoingPhysicsOnce: boolean
  /** Active ball hit tier (copied at spawn). */
  ballShotTier: PowerTier
  /** Perfect full send: first hit pierces (ball survives once). */
  ballPierceArmed: boolean
  /** After pierce, only rings with index ≥ this may register the next hit (deeper rows). */
  ballNextHitMinRing: number | null
  /** Active outgoing: reward band from last contact (trail / labels). */
  ballExitBand: ExitRewardBand
  /** Outgoing gravity scale (elite = gentler drop for carry). */
  ballOutgoingGravityMul: number

  score: number
  /** Countdown when timed mode is on; `null` when untimed. */
  timerRemainingSec: number | null
  timedMode: boolean
  /** Reserved for combo / bonus display on the scoreboard. */
  comboMultiplier: number
  releaseFlashRemain: number
  releaseFlashTier: PowerTier | null
  shakeRemain: number
  ballTrail: Vec2[]

  pointer: Vec2 | null
  /** Monotonic sim clock (s) for pitch + swing timing. */
  simTime: number
  /** When bat crossed the launch plane this swing; null until then. */
  batCrossLaunchTime: number | null
  /** `simTime` when swing phase started (release); spring hinge animation; null if idle/charging. */
  springSwingT0: number | null

  /** Monotonic pitch id for deterministic variation (each spawn increments). */
  pitchSeq: number

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
  debugHitCandidateCount: number
  debugHitWinnerLine: string
  /** Last outgoing collision pass: top candidates + scores (debug HUD). */
  debugHitCandidateLines: string[]
  debugVerticalBandPreview: VerticalShotBand | '—'
  debugVerticalBandAtContact: VerticalShotBand | '—'
  debugOutcomeClassPreview: OutcomeClass | '—'
  debugOutcomeClassAtContact: OutcomeClass | '—'

  /** Slow drifting cloud bonus targets (top band); separate from disc pegs. */
  cloudTargets: CloudTarget[]
  parachutePayloads: ParachutePayload[]
  cloudSpawnCountdown: number
  nextFloatingTargetId: number

  /** Single responsive scale vs 1600×900 design reference. */
  sceneLayout: SceneLayout
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
  const s = DISC_LAYOUT_SCALE
  const gap = minDim * DISC_RING_GAP_FR * s
  /** Back (largest) ring — slightly larger base fr so scale-up fills the frame. */
  const R3o = minDim * 0.315 * s
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

/**
 * Front-row hub Y in logical canvas space — the single vertical anchor for the disc gallery.
 * All deeper rows are `fy - n*sy` from here; do not nudge individual rings in Y.
 */
function galleryFrontRowAnchorY(h: number, layout: SceneLayout): number {
  return h * GALLERY_FRONT_CY_FR + designPx(layout, GALLERY_ROOT_OFFSET_Y_DESIGN)
}

/** Front row at anchor; deeper rows offset up-left + extra left spread (px). */
function layoutGalleryRingCenters(
  w: number,
  h: number,
  layout: SceneLayout
): Vec2[] {
  const m = Math.min(w, h)
  const fx = w * GALLERY_FRONT_CX_FR
  const fy = galleryFrontRowAnchorY(h, layout)
  const sx = m * GALLERY_DEPTH_STEP_X_FR
  const sy = m * GALLERY_DEPTH_STEP_Y_FR
  return [
    { x: fx, y: fy },
    {
      x: fx - sx - designPx(layout, GALLERY_RING_SHIFT_MID_DESIGN),
      y: fy - sy,
    },
    {
      x: fx - 2 * sx - designPx(layout, GALLERY_RING_SHIFT_BACK_DESIGN),
      y: fy - 2 * sy,
    },
  ]
}

function createDiscRingsForLayout(
  w: number,
  h: number,
  layout: SceneLayout
): DiscWheelRing[] {
  const minDim = Math.min(w, h)
  const radii = layoutDiscRingRadii(minDim)
  const centers = layoutGalleryRingCenters(w, h, layout)
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
  const centers = layoutGalleryRingCenters(w, h, sim.sceneLayout)
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
  revealLabels: boolean,
  targetR: number
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
    ctx.arc(pt.x, pt.y, targetR, 0, Math.PI * 2)
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

    const pts = targetPointsForRing(ringIdx)
    ctx.save()
    const fontPx = Math.round(clamp(targetR * 1.14, 12, 22))
    ctx.font = `600 ${fontPx}px "Oswald", "Bebas Neue", Impact, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const dimLabel = !upper || !active
    ctx.lineWidth = dimLabel ? 1.5 : 2.25
    ctx.strokeStyle = dimLabel ? 'rgba(0,0,0,0.42)' : 'rgba(0,0,0,0.35)'
    ctx.fillStyle = dimLabel
      ? 'rgba(240, 242, 248, 0.52)'
      : 'rgba(255,255,255,0.97)'
    const label = String(pts)
    ctx.strokeText(label, pt.x, pt.y)
    ctx.fillText(label, pt.x, pt.y)
    ctx.restore()

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
  /** Pivot dot, bat AABB, θ label (and throttled console θ). */
  showSpriteDebug: boolean
  /**
   * Fill logical viewport red before the stadium bg: transparent regions in the
   * background PNG show red; confirms alpha is compositing (not a solid underlay).
   */
  transparencyUnderlayTest: boolean
  /**
   * When false: no disc rendering, collisions, scoring, or disc target/occluder logic (dev only).
   */
  enableSpinningDiscs: boolean
  /** Frame rect, hero pivot, scoreboard AABB, disc hubs + `sceneLayout.scale` readout. */
  showSceneLayoutDebug: boolean
}

function createSim(w: number, h: number): Sim {
  const sceneLayout = computeSceneLayout(w, h)
  const pivot: Vec2 = { x: w * BAT_PIVOT_X_FR, y: h * BAT_PIVOT_Y_FR }
  const batLen = Math.min(w, h) * 0.216
  const rings = createDiscRingsForLayout(w, h, sceneLayout)
  const sim: Sim = {
    w,
    h,
    sceneLayout,
    dpr: 1,
    pivot,
    batLen,
    spriteLayout: null,
    rings,
    debugAllTargetsTriggered: false,
    ball: null,
    incomingPitches: [],
    pitchNextIn: 0.38,
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
    skipOutgoingPhysicsOnce: false,
    ballPierceArmed: false,
    ballNextHitMinRing: null,
    ballExitBand: 'standard',
    ballOutgoingGravityMul: 1,
    score: 0,
    timedMode: SCOREBOARD_TIMED_MODE,
    timerRemainingSec: SCOREBOARD_TIMED_MODE ? SCOREBOARD_TIME_LIMIT_SEC : null,
    comboMultiplier: 1,
    releaseFlashRemain: 0,
    releaseFlashTier: null,
    shakeRemain: 0,
    ballTrail: [],
    pointer: null,
    simTime: 0,
    batCrossLaunchTime: null,
    springSwingT0: null,
    pitchSeq: 0,
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
    debugHitCandidateCount: 0,
    debugHitWinnerLine: '',
    debugHitCandidateLines: [],
    debugVerticalBandPreview: '—',
    debugVerticalBandAtContact: '—',
    debugOutcomeClassPreview: '—',
    debugOutcomeClassAtContact: '—',
    cloudTargets: [],
    parachutePayloads: [],
    cloudSpawnCountdown: 0,
    nextFloatingTargetId: 1,
  }
  initFloatingCloudLayer(sim)
  return sim
}

function layoutSim(
  sim: Sim,
  w: number,
  h: number,
  sprites: LoadedGameSprites | null
): void {
  sim.w = w
  sim.h = h
  sim.sceneLayout = computeSceneLayout(w, h)
  if (sprites) {
    const sl = computeSpriteLayout(
      w,
      h,
      sprites.statue,
      sprites.bat,
      sprites.statueOpaque,
      sprites.batOpaque,
      sim.sceneLayout
    )
    sim.spriteLayout = sl
    sim.pivot = sl.pivot
    sim.batLen = sl.batLen
  } else {
    sim.spriteLayout = null
    sim.pivot = { x: w * BAT_PIVOT_X_FR, y: h * BAT_PIVOT_Y_FR }
    sim.batLen = Math.min(w, h) * 0.216
  }
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

function grabDistThreshPx(sim: Sim): number {
  const m = Math.min(sim.w, sim.h)
  return Math.max(
    designPx(sim.sceneLayout, GRAB_THRESH_BASE_DESIGN),
    sim.batLen * GRAB_THRESH_BATLEN_FR,
    m * GRAB_THRESH_MIN_CANVAS_FR
  )
}

function nearBat(sim: Sim): boolean {
  if (!sim.pointer) return false
  const { pointer: p, pivot, batLen, theta } = sim
  const thresh = grabDistThreshPx(sim)
  const threshSq = thresh * thresh

  const segDist = (tipX: number, tipY: number) =>
    distSqPointSegment(p.x, p.y, pivot.x, pivot.y, tipX, tipY)

  const tipPhys = batTip(pivot, batLen, theta)
  let best = segDist(tipPhys.x, tipPhys.y)

  if (sim.spriteLayout) {
    const tipVis = batTip(
      pivot,
      batLen,
      theta + sim.spriteLayout.batRotDeltaRad
    )
    best = Math.min(best, segDist(tipVis.x, tipVis.y))
  }

  return best <= threshSq
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
  if (ae > TIMING_POOR_SEC) return 'dribble'
  if (ae > TIMING_GOOD_SEC) return timingErrorSec < 0 ? 'poor_early' : 'poor_late'
  if (ae > TIMING_PERFECT_SEC)
    return timingErrorSec < 0 ? 'good_early' : 'good_late'
  return 'perfect'
}

function contactQuality01(timingErrorSec: number): number {
  const ae = Math.abs(timingErrorSec)
  /** High floor: mediocre timing still feels like baseball, not a dud. */
  return clamp(1 - ae / TIMING_GOOD_SEC, 0.58, 1)
}

function powerTierFromTimingAbs(absErr: number): PowerTier {
  if (absErr <= TIMING_PERFECT_SEC) return 'perfect_full_send'
  if (absErr <= TIMING_GOOD_SEC * 0.5) return 'full_send'
  if (absErr <= TIMING_GOOD_SEC) return 'strong'
  return 'normal'
}

/** 1 at sweet-spot center, 0 outside radius (in bat t-space). */
function sweetSpotQuFromT(tAlongBat: number): number {
  const d = Math.abs(tAlongBat - SWEET_SPOT_T)
  const r = SWEET_SPOT_RADIUS_FR
  if (d >= r) return 0
  const u = d / r
  return 1 - u * u
}

/** Pick variant params for a given pitch sequence id (each spawn uses a fresh `seq`). */
function pickPitchVariantFields(sim: Sim, seq: number): {
  pitchContactFracT: number
  pitchSpeedNominal: number
  pitchIncomingAy: number
  pitchReleaseDyPx: number
} {
  const n = seq
  const m = Math.min(sim.w, sim.h)
  const a0 = pitchVariant01(n, 1)
  const a1 = pitchVariant01(n, 2)
  const a2 = pitchVariant01(n, 3)
  const a3 = pitchVariant01(n, 4)
  const a5 = pitchVariant01(n, 5)
  const a6 = pitchVariant01(n, 6)
  /** Rich height variety + upward bias; second harmonic avoids “same pitch every time”. */
  const heightU = clamp(
    0.64 +
      0.32 * Math.sin(a0 * Math.PI * 2) +
      0.14 * Math.sin(a0 * 7.21 + n * 0.37),
    0,
    1
  )
  const spanT = PITCH_CONTACT_FR_MAX - PITCH_CONTACT_FR_MIN
  const pitchContactFracT = clamp(
    PITCH_CONTACT_FR_MIN +
      heightU * spanT +
      (a5 - 0.5) * 0.1 +
      (a6 - 0.5) * 0.045,
    PITCH_CONTACT_FR_MIN,
    PITCH_CONTACT_FR_MAX
  )
  const pitchSpeedNominal =
    PITCH_SPEED_MIN + a1 * (PITCH_SPEED_MAX - PITCH_SPEED_MIN)
  const aySpan = PITCH_INCOMING_AY_MAX - PITCH_INCOMING_AY_MIN
  const ayRaw = PITCH_INCOMING_AY_MIN + a2 * aySpan
  /** Strong bias to hang / ride vs dive at the hands. */
  const pitchIncomingAy = ayRaw * 0.45 + PITCH_INCOMING_AY_MIN * 0.55
  const pitchReleaseDyPx =
    (a3 - 0.5) * 1.45 * PITCH_RELEASE_DY_FR * m + PITCH_RELEASE_DY_BIAS_FR * m
  return {
    pitchContactFracT,
    pitchSpeedNominal,
    pitchIncomingAy,
    pitchReleaseDyPx,
  }
}

/** Planned contact on the launch-plane bat for the given height parameter. */
function pitchPlannedContactPoint(sim: Sim, pitchContactFracT: number): Vec2 {
  const aimLen = Math.min(sim.batLen, sim.h * PITCH_AIM_BAT_LEN_MAX_FR)
  return batPointAlong(
    sim.pivot,
    aimLen,
    THETA_LAUNCH,
    pitchContactFracT
  )
}

/** World position where the pitch spawns (mound). */
function pitchMoundScreenPoint(sim: Sim, pitchReleaseDyPx: number): Vec2 {
  return {
    x: sim.w * PITCH_MOUND_X_FR,
    y:
      sim.h * PITCH_MOUND_Y_FR +
      pitchReleaseDyPx * 0.35 -
      designPx(sim.sceneLayout, PITCH_MOUND_NUDGE_UP_DESIGN),
  }
}

/** Incoming pitch whose ideal contact time is closest to now (guidance / preview). */
function primaryIncomingForGuidance(sim: Sim): IncomingPitch | null {
  const arr = sim.incomingPitches
  if (!arr.length) return null
  let best = arr[0]
  let bestD = Math.abs(best.idealContactTime - sim.simTime)
  for (let i = 1; i < arr.length; i++) {
    const c = arr[i]
    const d = Math.abs(c.idealContactTime - sim.simTime)
    if (d < bestD) {
      best = c
      bestD = d
    }
  }
  return best
}

/** Depth cue: radius ramps from small (“far”) to full size near the plate. */
function updateIncomingBallDepthRadiusFor(
  sim: Sim,
  simTime: number,
  pitchSpawnSimTime: number,
  idealContactTime: number,
  b: Ball
): void {
  const br = ballRadiusPx(sim)
  const t0 = pitchSpawnSimTime
  const t1 = idealContactTime
  if (t0 < 0 || t1 <= t0) {
    b.r = br
    return
  }
  const u = clamp((simTime - t0) / (t1 - t0), 0, 1)
  const smooth = u * u * (3 - 2 * u)
  const mul =
    PITCH_DEPTH_START_R_MUL + (1 - PITCH_DEPTH_START_R_MUL) * smooth
  b.r = br * mul
}

function combinedTransfer(
  quality: number,
  sweetQu: number,
  pullbackU: number
): number {
  const sw = 0.36 + 0.64 * sweetQu
  const pu = 0.46 + 0.54 * pullbackU
  return clamp(0.32 + 0.68 * quality * sw * pu, 0, 1)
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
    return (errSec / Math.max(p, 1e-6)) * 0.22
  }
  const sign = Math.sign(errSec)
  const past = a - p
  const span = Math.max(g - p, 1e-6)
  const u = clamp(past / span, 0, 1)
  const u2 = u * u
  return sign * (0.22 + u2 * 1.05)
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
    pu >= 0.88 &&
    quality >= 0.88 &&
    sweetQu >= 0.72
  ) {
    return 'moonshot'
  }
  if (
    score >= EXIT_SCORE_POWER &&
    pu >= 0.76 &&
    quality >= 0.74 &&
    sweetQu >= 0.38
  ) {
    return 'power'
  }
  if (score >= EXIT_SCORE_CARRY && pu >= 0.52 && quality >= 0.55) {
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
      return { loftRad: 0.2, speedMul: 1.34, gravityMul: 0.62 }
    case 'power':
      return { loftRad: 0.075, speedMul: 1.14, gravityMul: 0.78 }
    case 'carry':
      return { loftRad: 0.048, speedMul: 1.022, gravityMul: 0.88 }
    default:
      return { loftRad: 0.042, speedMul: 1.03, gravityMul: 0.86 }
  }
}

/** Sample Y when ball crosses gallery plane (or fixed t) vs disc vertical bounds. */
function verticalOutcomeBandAtGalleryCrossing(
  sim: Sim,
  fromX: number,
  fromY: number,
  vx: number,
  vy: number,
  gEff: number
): VerticalShotBand {
  const b = galleryPlayBounds(sim)
  const yTopField = b.cy - b.halfH * 0.96
  const yBotField = b.cy + b.halfH * 0.9
  let tSample = 0.38
  if (vx < -45) {
    const tX = (b.cx - fromX) / vx
    if (tX > 0.06 && tX < 0.88) tSample = tX
  }
  const yAt = fromY + vy * tSample + 0.5 * gEff * tSample * tSample
  if (yAt < yTopField - 32) return 'HIGH'
  if (yAt > yBotField + 52) return 'LOW'
  return 'PLAYFIELD'
}

function classifyOutcomeClass(exitBand: ExitRewardBand): OutcomeClass {
  if (exitBand === 'moonshot') return 'elite'
  if (exitBand === 'power' || exitBand === 'carry') return 'strong'
  return 'ordinary'
}

/** −1 = full charge toward left, +1 toward right (rest ≈ 0). Player agency on field aim. */
function chargePullSteer01(theta: number): number {
  return clamp((theta - THETA_REST) / (Math.PI * 0.5), -1, 1)
}

function chargeThetaForAimPreview(sim: Sim): number {
  return sim.phase === 'charging' ? sim.theta : sim.thetaRelease
}

/**
 * Baseball-style contact: timing + sweet-spot + pullback + **charge angle** + per-pitch spread.
 */
function battedBallOutcome(
  sim: Sim,
  timingErrorSec: number,
  fromX: number,
  fromY: number,
  pullbackU: number,
  sweetQu: number,
  /** Pivot→tip contact parameter on bat (live or planned); shapes jam vs pop. */
  contactAlongT: number,
  /** Bat angle at release (or current θ while charging for preview). */
  chargeTheta: number,
  /** Per-pitch variant id (incoming flight’s `pitchSeq`) for aim spread hashes. */
  variantPitchSeq: number
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
  verticalBand?: VerticalShotBand
  outcomeClass?: OutcomeClass
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
  const ch = chargePullSteer01(chargeTheta)
  const vHash = pitchVariant01(variantPitchSeq, 11)
  const hHash = pitchVariant01(variantPitchSeq + 5, 12)

  /**
   * Vertical funnel: larger frac → higher aim on the board (stay in target band).
   * Biased upward; charge/hash penalties are mild so shots don’t default under the lip.
   */
  const playFracAnchor = 0.53 + 0.065 * quality * sweetQu
  const pullPoor =
    (bucket === 'dribble' ? 0.32 : 0.19) *
    (1 - quality) *
    (1 - 0.16 * sweetQu)
  const verticalFrac = clamp(
    playFracAnchor -
      pullPoor +
      tSteer * tSteer * 0.028 +
      (vHash - 0.5) * 0.085 * (0.5 + 0.5 * quality) +
      ch * -0.016 +
      0.045,
    0.32,
    0.66
  )
  const aimTx =
    b.cx +
    tSteer * b.halfW * 0.94 +
    ch * b.halfW * 0.44 +
    (hHash - 0.5) * b.halfW * 0.24 * (0.5 + 0.5 * sweetQu)
  const aimTy = b.cy - b.halfH * verticalFrac

  const rdx = aimTx - fromX
  const rdy = aimTy - fromY
  const refAngle = Math.atan2(rdy, rdx)

  const aimStiffness = 0.38 + 0.62 * sweetQu
  const trimYaw = tSteer * TIMING_YAW_MAX_RAD * aimStiffness

  const jitter =
    Math.sin(
      timingErrorSec * 103.417 + sweetQu * 27.913 + pullbackU * 8.771
    ) *
    OFF_BARREL_ANGLE_SCATTER_RAD *
    (1 - sweetQu)

  /** Pullback → mostly speed via band; loft is a small, capped add (no full-power sky default). */
  const pu = clamp(pullbackU, 0, 1)
  const pullLoft = clamp(
    (pu - 0.1) *
      PULLBACK_LOFT_MAX_RAD *
      PULLBACK_LOFT_STRENGTH *
      (0.42 + 0.58 * sweetQu),
    -0.012,
    0.13
  )

  const baseLoft =
    bucket === 'dribble' ? DRIBBLE_BASE_LOFT_RAD : FAIR_CONTACT_BASE_LOFT_RAD
  const midBarrelT = 0.62
  const barrelOff = clamp(contactAlongT - midBarrelT, -0.36, 0.36)
  const barrelShapeMul = bucket === 'dribble' ? 0.52 : 1
  /** Lower on barrel → jam lean (softer than before so good barrel isn’t always “off low”). */
  const barrelLoftRad = barrelShapeMul * clamp(barrelOff * 0.1, -0.048, 0.12)
  const cleanLiftRad =
    bucket === 'dribble' ? 0 : 0.032 * quality * (0.4 + 0.6 * sweetQu)
  const playfieldBiasRad =
    PLAYFIELD_LAUNCH_BIAS_RAD *
    (bucket === 'dribble' ? PLAYFIELD_LAUNCH_BIAS_DRIBBLE_MUL : 1)
  const baseAngle =
    refAngle +
    trimYaw +
    jitter +
    pullLoft +
    baseLoft +
    barrelLoftRad +
    cleanLiftRad +
    playfieldBiasRad

  let speed: number
  if (bucket === 'dribble') {
    const v0 =
      OUT_SPEED_DRIBBLE *
      (0.52 + 0.4 * quality) *
      (0.58 + 0.42 * pu) *
      (0.65 + 0.35 * sweetQu)
    speed = clamp(v0, 340, OUT_SPEED_MIN * 0.88)
  } else {
    const pullCore = Math.pow(pu, 0.58)
    const speedBand = OUT_SPEED_MIN + pullCore * (OUT_SPEED_MAX - OUT_SPEED_MIN)
    const timingEff = 0.6 + 0.4 * quality
    const barrelEff = 0.74 + 0.26 * sweetQu
    speed = speedBand * timingEff * barrelEff
    speed = clamp(speed, 520, OUT_SPEED_MAX)
  }

  const exitBand = classifyExitRewardBand(pu, quality, sweetQu, bucket)
  const bon = exitBandBonuses(exitBand)
  const angle = baseAngle + bon.loftRad
  let speedOut = speed * bon.speedMul
  const maxSp =
    exitBand === 'moonshot'
      ? OUT_SPEED_MAX * 1.36
      : exitBand === 'power'
        ? OUT_SPEED_MAX * 1.12
        : exitBand === 'carry'
          ? OUT_SPEED_MAX * 1.04
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
      Math.abs(timingErrorSec) <= TIMING_GOOD_SEC * 0.36 &&
      sweetQu >= 0.55 &&
      pu >= 0.84
    ) {
      tier = 'perfect_full_send'
    } else if (tier !== 'perfect_full_send') {
      tier = 'full_send'
    }
  } else if (exitBand === 'power' && tier === 'normal' && quality >= 0.62) {
    tier = 'strong'
  }

  const gEff = OUTGOING_GRAVITY * bon.gravityMul
  const verticalBand = verticalOutcomeBandAtGalleryCrossing(
    sim,
    fromX,
    fromY,
    vx,
    vy,
    gEff
  )
  const outcomeClass = classifyOutcomeClass(exitBand)

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
    verticalBand,
    outcomeClass,
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

/**
 * timingError for preview: after the bat has crossed launch, use live sim time vs ideal
 * (matches generous swing-window contact). Before cross, keep predicted cross vs ideal.
 */
function predictTimingErrorForPreview(sim: Sim): number | null {
  const primary = primaryIncomingForGuidance(sim)
  if (primary == null || primary.idealContactTime <= 0) return null
  if (
    sim.batCrossLaunchTime != null &&
    (sim.phase === 'swing' || sim.phase === 'recovery')
  ) {
    return sim.simTime - primary.idealContactTime
  }
  const tBat = predictNextBatCrossTime(sim)
  if (tBat == null) return null
  return tBat - primary.idealContactTime
}

function computePitchHud(sim: Sim): PitchHudState {
  if (sim.debugContactFlash > 0) return 'contact'
  if (sim.ballRole === 'outgoing') return 'outgoing'
  if (sim.incomingPitches.length > 0) return 'incoming'
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

/**
 * Always-on (non-debug) cues: pitch corridor, contact disk, and a “ripe” hint when the ball
 * is near ideal contact time.
 */
function drawHittingGuidance(ctx: CanvasRenderingContext2D, sim: Sim): void {
  const primary = primaryIncomingForGuidance(sim)
  if (primary == null || primary.idealContactTime <= 0) return
  const ix = pitchPlannedContactPoint(sim, primary.pitchContactFracT)
  const mound = pitchMoundScreenPoint(sim, primary.pitchReleaseDyPx)
  const moundX = mound.x
  const moundY = mound.y

  ctx.save()

  if (sim.incomingPitches.length > 0 || sim.phase === 'charging') {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
    ctx.lineWidth = 16
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(moundX, moundY)
    ctx.lineTo(ix.x, ix.y)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(190, 215, 255, 0.2)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(moundX, moundY)
    ctx.lineTo(ix.x, ix.y)
    ctx.stroke()
  }

  const dtToIdeal = primary.idealContactTime - sim.simTime
  const ripe = Math.abs(dtToIdeal) < TIMING_RIPE_WINDOW_SEC
  ctx.setLineDash([7, 6])
  ctx.strokeStyle = ripe
    ? 'rgba(255, 215, 110, 0.48)'
    : 'rgba(150, 210, 255, 0.26)'
  ctx.lineWidth = ripe ? 2.75 : 1.85
  ctx.beginPath()
  ctx.arc(ix.x, ix.y, contactZoneRadiusPx(sim) * 0.9, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([])

  if (ripe) {
    const b = primary.ball
    ctx.strokeStyle = 'rgba(255, 195, 80, 0.62)'
    ctx.lineWidth = 2
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.arc(b.x, b.y, b.r + 11, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
  }

  ctx.restore()
}

function angularDiff(a: number, b: number): number {
  let d = a - b
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return Math.abs(d)
}

/** 0 = front/smallest (nearest), 2 = back/largest (farthest). */
function ringRowDepth(ringIndex: number): number {
  return ringIndex
}

/**
 * Fake depth on tilted wheel for tie-breaks (consistent per rim angle).
 * Not physical 3D — stable ordering around the disc.
 */
function localTargetDepthOnWheel(worldAngle: number): number {
  return 0.5 + 0.5 * Math.sin(worldAngle)
}

type TargetHitCandidate = {
  ringIdx: number
  slotIdx: number
  tHit: number
  rowDepth: number
  localDepth: number
  perpDist: number
  alongRay: number
  effPerp: number
  effSort: number
  pathAlign01: number
  depthScore: number
  combinedScore: number
}

function flightUnitVector(b: Ball, x0: number, y0: number, x1: number, y1: number): {
  ux: number
  uy: number
} {
  const sp = Math.hypot(b.vx, b.vy)
  if (sp > 45) {
    return { ux: b.vx / sp, uy: b.vy / sp }
  }
  const dx = x1 - x0
  const dy = y1 - y0
  const sl = Math.hypot(dx, dy)
  if (sl > 1e-4) {
    return { ux: dx / sl, uy: dy / sl }
  }
  return { ux: 1, uy: 0 }
}

/**
 * One shot → one primary target: gather segment overlaps, then pick the intercept that
 * best matches the ball’s flight corridor (perp distance to velocity ray), not merely
 * earliest screen-space entry — reduces “right-edge vacuum” steals from weak alignment.
 */
function resolveSingleTargetHit(
  sim: Sim,
  b: Ball,
  dt: number
): { ring: number; idx: number } | null {
  const x0 = b.x - b.vx * dt
  const y0 = b.y - b.vy * dt
  const x1 = b.x
  const y1 = b.y
  const tR = targetRadiusPx(sim)
  const expandedR = tR + b.r
  const minRing = sim.ballNextHitMinRing ?? 0
  const { ux, uy } = flightUnitVector(b, x0, y0, x1, y1)

  const candidates: TargetHitCandidate[] = []

  for (let r = minRing; r < RING_COUNT; r++) {
    const ring = sim.rings[r]
    const Rmid = ringMidFromDiscRing(ring)
    const rowDepth = ringRowDepth(r)
    for (let i = 0; i < ring.targetSlots.length; i++) {
      const slot = ring.targetSlots[i]
      if (!slot.isActive) continue
      const worldAngle = ring.rotation + ring.slotAngles[i]
      if (!targetIsExposedAboveOccluder(ring, Rmid, worldAngle)) continue

      const tp = ringScreenPoint(
        ring.center.x,
        ring.center.y,
        DISC_SX,
        Rmid,
        worldAngle
      )

      let tHit = segmentCircleEarliestHit(
        x0,
        y0,
        x1,
        y1,
        tp.x,
        tp.y,
        expandedR
      )
      if (
        tHit == null &&
        circlesOverlap(x1, y1, b.r, tp.x, tp.y, tR)
      ) {
        tHit = 1
      }
      if (tHit == null) continue

      const { perp, along } = distPointToUnitRay(tp.x, tp.y, x0, y0, ux, uy)
      const behind = along < 0 ? -along * HIT_BEHIND_RAY_PENALTY : 0
      const effPerp = perp + behind
      const effSort = effPerp - rowDepth * HIT_DEPTH_SORT_BIAS
      const pathAlign01 = clamp(
        1 - effPerp / (expandedR * HIT_PATH_CORRIDOR_MULT),
        0,
        1
      )
      const localDepth = localTargetDepthOnWheel(worldAngle)
      const depthScore = rowDepth / Math.max(1, RING_COUNT - 1) * 0.55 + localDepth * 0.45
      const combinedScore =
        pathAlign01 * 100 - tHit * 18 + depthScore * 6 + rowDepth * 0.35

      candidates.push({
        ringIdx: r,
        slotIdx: i,
        tHit,
        rowDepth,
        localDepth,
        perpDist: perp,
        alongRay: along,
        effPerp,
        effSort,
        pathAlign01,
        depthScore,
        combinedScore,
      })
    }
  }

  sim.debugHitCandidateCount = candidates.length
  if (candidates.length === 0) {
    sim.debugHitWinnerLine = '—'
    sim.debugHitCandidateLines = []
    return null
  }

  candidates.sort((A, B) => {
    const dS = A.effSort - B.effSort
    if (Math.abs(dS) > 1e-6) return dS
    if (Math.abs(A.tHit - B.tHit) > 1e-5) return A.tHit - B.tHit
    if (A.rowDepth !== B.rowDepth) return B.rowDepth - A.rowDepth
    return A.localDepth - B.localDepth
  })

  const win = candidates[0]
  sim.debugHitWinnerLine = `WIN r${win.ringIdx} s${win.slotIdx} t=${win.tHit.toFixed(3)} perp=${win.perpDist.toFixed(1)} eff=${win.effPerp.toFixed(1)} align=${win.pathAlign01.toFixed(2)} zR=${win.rowDepth} zL=${win.localDepth.toFixed(2)} comb=${win.combinedScore.toFixed(1)} (n=${candidates.length})`

  const topN = Math.min(5, candidates.length)
  const lines: string[] = []
  for (let k = 0; k < topN; k++) {
    const c = candidates[k]
    const tag = k === 0 ? '★' : ' '
    lines.push(
      `${tag} r${c.ringIdx}s${c.slotIdx} t=${c.tHit.toFixed(2)} perp=${c.perpDist.toFixed(1)} align=${c.pathAlign01.toFixed(2)} depth=${c.depthScore.toFixed(2)} comb=${c.combinedScore.toFixed(1)}`
    )
  }
  sim.debugHitCandidateLines = lines

  return { ring: win.ringIdx, idx: win.slotIdx }
}

function chainDestroyNeighbors(
  sim: Sim,
  ringIdx: number,
  hitIndex: number
): void {
  const ring = sim.rings[ringIdx]
  const aHit = ring.rotation + ring.slotAngles[hitIndex]
  for (let j = 0; j < ring.targetSlots.length; j++) {
    if (j === hitIndex || !ring.targetSlots[j].isActive) continue
    const aj = ring.rotation + ring.slotAngles[j]
    if (angularDiff(aHit, aj) <= CHAIN_ANGLE_RAD) {
      ring.targetSlots[j].wasTriggered = true
      ring.targetSlots[j].isActive = false
      sim.score += targetPointsForRing(ringIdx)
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
  }
): void {
  const { pivot: p, batLen: L } = sim
  const s = sim.sceneLayout.scale
  const barW = clamp(
    L * 2.45,
    designPx(sim.sceneLayout, POWER_BAR_MIN_WIDTH_DESIGN),
    sim.w * 0.58
  )
  const barH = designPx(sim.sceneLayout, POWER_BAR_HEIGHT_DESIGN)
  const arcTopY = p.y - L
  const padEdge = Math.max(6, 10 * s)
  let by =
    arcTopY -
    designPx(sim.sceneLayout, POWER_BAR_GAP_ABOVE_SWING_DESIGN) -
    barH -
    designPx(sim.sceneLayout, POWER_BAR_LABEL_CLEARANCE_DESIGN) +
    designPx(sim.sceneLayout, POWER_BAR_DROP_TOWARD_PIVOT_DESIGN)
  by = clamp(by, padEdge, sim.h - barH - padEdge)
  const bx = clamp(p.x - barW / 2, padEdge, sim.w - barW - padEdge)

  const phaseDim =
    sim.phase === 'recovery' ? 0.55 : sim.phase === 'swing' ? 0.88 : 1

  ctx.save()
  ctx.globalAlpha = phaseDim

  ctx.fillStyle = 'rgba(14, 24, 28, 0.48)'
  ctx.strokeStyle = 'rgba(95, 175, 160, 0.42)'
  ctx.lineWidth = Math.max(1.25, 2 * s)
  ctx.beginPath()
  ctx.roundRect(bx, by, barW, barH, Math.max(4, 7 * s))
  ctx.fill()
  ctx.stroke()

  const hiPad = Math.max(1.5, 2 * s)
  if (opts?.perfectSendLocked) {
    ctx.strokeStyle = 'rgba(255, 140, 90, 0.52)'
    ctx.lineWidth = Math.max(2, 3 * s)
    ctx.strokeRect(
      bx - hiPad,
      by - hiPad,
      barW + hiPad * 2,
      barH + hiPad * 2
    )
  } else if (opts?.fullSendLocked || opts?.fullSendZoneLive) {
    ctx.strokeStyle = 'rgba(255, 215, 150, 0.48)'
    ctx.lineWidth = opts?.fullSendLocked ? Math.max(2, 2.5 * s) : Math.max(1.25, 1.75 * s)
    ctx.strokeRect(
      bx - hiPad,
      by - hiPad,
      barW + hiPad * 2,
      barH + hiPad * 2
    )
  }

  const fp = clamp(fillP, 0, 1)
  if (fp > 0) {
    const innerPad = Math.max(3, 5 * s)
    const iw = barW - innerPad * 2
    const ih = barH - innerPad * 2
    const g = ctx.createLinearGradient(bx, by, bx + iw, by)
    g.addColorStop(0, powerBarColor(fp))
    g.addColorStop(1, powerBarColor(fp * 0.92))
    ctx.globalAlpha = phaseDim * 0.68
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.roundRect(
      bx + innerPad,
      by + innerPad,
      iw * fp,
      ih,
      Math.min(6 * s, ih * 0.45)
    )
    ctx.fill()
    ctx.globalAlpha = phaseDim
  }

  const pct = Math.round(fp * 100)
  const mainLine = label.trim() ? `${pct}% ${label}` : `${pct}%`
  const subLine = opts?.perfectSendLocked
    ? 'PERFECT FULL SEND'
    : opts?.fullSendLocked
      ? 'FULL SEND'
      : opts?.fullSendZoneLive
        ? 'Full send zone'
        : null

  const padX = Math.max(6, 10 * s)
  const cx = bx + barW / 2
  ctx.textAlign = 'center'
  if (subLine) {
    ctx.fillStyle = 'rgba(225, 248, 238, 0.92)'
    ctx.font = `600 ${Math.max(8, Math.round(12 * s))}px "Oswald", "Arial Narrow", system-ui, sans-serif`
    ctx.textBaseline = 'middle'
    ctx.fillText(mainLine, cx, by + barH * 0.34, barW - padX * 2)
    ctx.fillStyle = 'rgba(255, 210, 175, 0.9)'
    ctx.font = `600 ${Math.max(7, Math.round(9 * s))}px "Oswald", system-ui, sans-serif`
    ctx.fillText(subLine, cx, by + barH * 0.72, barW - padX * 2)
  } else {
    ctx.fillStyle = 'rgba(225, 248, 238, 0.9)'
    ctx.font = `600 ${Math.max(9, Math.round(13 * s))}px "Oswald", "Arial Narrow", system-ui, sans-serif`
    ctx.textBaseline = 'middle'
    ctx.fillText(mainLine, cx, by + barH / 2, barW - padX * 2)
  }
  ctx.textAlign = 'left'

  ctx.restore()
}

/** Temporary: verify all gameplay uses `sceneLayout.scale` + design-space offsets. */
function drawSceneLayoutDebug(ctx: CanvasRenderingContext2D, sim: Sim): void {
  const { w, h } = sim
  const s = sim.sceneLayout.scale
  ctx.save()
  ctx.strokeStyle = 'rgba(0, 255, 140, 0.55)'
  ctx.lineWidth = Math.max(1, 2 * s)
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1)
  ctx.fillStyle = 'rgba(0, 255, 140, 0.9)'
  ctx.font = `${Math.max(8, Math.round(11 * s))}px ui-monospace, monospace`
  ctx.textAlign = 'left'
  ctx.fillText(
    `scene scale ${s.toFixed(3)}  design ${DESIGN_REF_W}×${DESIGN_REF_H}`,
    8,
    14 * s + 10
  )

  ctx.fillStyle = 'rgba(255, 60, 200, 0.95)'
  ctx.beginPath()
  ctx.arc(sim.pivot.x, sim.pivot.y, Math.max(3, 5 * s), 0, Math.PI * 2)
  ctx.fill()

  const sb = getScoreboardScreenRect(w, h, {
    score: sim.score,
    timedMode: sim.timedMode,
    timerRemainingSec: sim.timerRemainingSec,
    comboMultiplier: sim.comboMultiplier,
  }, s)
  ctx.strokeStyle = 'rgba(120, 210, 255, 0.85)'
  ctx.lineWidth = Math.max(1, 1.5 * s)
  ctx.strokeRect(sb.x, sb.y, sb.width, sb.height)

  for (const ring of sim.rings) {
    ctx.strokeStyle = 'rgba(255, 210, 100, 0.9)'
    ctx.beginPath()
    ctx.arc(ring.center.x, ring.center.y, Math.max(2, 4 * s), 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * Diffuse ground-plane shadow under statue + bat: wide soft ellipse, stable (no bat θ).
 */
function drawGroundContactShadow(
  ctx: CanvasRenderingContext2D,
  sim: Sim
): void {
  if (!sim.spriteLayout) return

  const { pivot: p, batLen: L } = sim
  const pullU =
    sim.phase === 'charging'
      ? sim.pCurrent
      : sim.phase === 'swing' || sim.phase === 'recovery'
        ? sim.pRelease
        : 0
  const wScale = 1 + GROUND_SHADOW_PULLBACK_STRETCH * clamp(pullU, 0, 1)
  const rx = L * GROUND_SHADOW_W_FR * 0.5 * wScale
  const ry = L * GROUND_SHADOW_H_FR * 0.5
  const s = sim.sceneLayout.scale
  const cx = p.x + designPx(sim.sceneLayout, GROUND_SHADOW_OFFSET_X)
  const cy = p.y + designPx(sim.sceneLayout, GROUND_SHADOW_OFFSET_Y)

  ctx.save()
  ctx.globalCompositeOperation = 'source-over'

  const drawBlob = (
    blurPx: number,
    rxa: number,
    rya: number,
    centerA: number,
    midA: number,
    edgeA: number
  ) => {
    ctx.filter = `blur(${blurPx}px)`
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rxa, rya) * 1.15)
    g.addColorStop(0, `rgba(12, 16, 26, ${centerA})`)
    g.addColorStop(0.42, `rgba(10, 14, 24, ${midA})`)
    g.addColorStop(0.78, `rgba(8, 12, 22, ${edgeA * 0.35})`)
    g.addColorStop(1, 'rgba(6, 10, 20, 0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.ellipse(cx, cy, rxa, rya, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  drawBlob(22 * s, rx * 1.32, ry * 1.12, 0.11, 0.055, 0.02)
  drawBlob(12 * s, rx * 0.88, ry * 0.82, 0.16, 0.075, 0.03)
  ctx.filter = 'none'

  ctx.restore()
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

type DynamicBallDrawOpts = {
  streakMul?: number
  smearThreshold?: number
  motionBlurSteps?: number
  speedLines?: boolean
  redFlames?: boolean
  stretchMul?: number
  brightBall?: boolean
}

/** Draw ball with velocity-aligned stretch + backward smear (reads as blur in motion). */
function drawDynamicBall(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  vx: number,
  vy: number,
  fillStyle: string,
  strokeStyle: string,
  lineWidth: number,
  stroke: boolean,
  opts?: DynamicBallDrawOpts
): number {
  const smearThreshold = opts?.smearThreshold ?? 55
  const streakMul = opts?.streakMul ?? 1
  const blurSteps = Math.min(
    10,
    Math.max(3, opts?.motionBlurSteps ?? BALL_MOTION_BLUR_STEPS)
  )
  const stretchMul = opts?.stretchMul ?? 1
  const brightBall = opts?.brightBall ?? false

  const sp = Math.hypot(vx, vy)
  const angle = sp > 12 ? Math.atan2(vy, vx) : 0
  const u = sp > 12 ? Math.min(sp / BALL_STRETCH_SPEED_REF, 1) : 0
  const stretch = Math.min(1 + u * BALL_STRETCH_MAX * stretchMul, 1.92)
  const squash = 1 / Math.sqrt(stretch)

  if (sp > smearThreshold) {
    const ux = vx / sp
    const uy = vy / sp
    const streakPx =
      Math.min(r * 1.1 + sp * 0.018, r * 4.2) * streakMul +
      (opts?.speedLines ? sp * 0.014 : 0)
    ctx.save()
    for (let i = blurSteps; i >= 1; i--) {
      const t = i / blurSteps
      const px = x - ux * streakPx * t * 0.92
      const py = y - uy * streakPx * t * 0.92
      const tr = r * (0.88 + 0.12 * (1 - t)) * (0.92 + 0.08 * squash)
      const ga =
        0.11 *
        (1 - t * 0.75) *
        Math.min(sp / 320, 1) *
        (brightBall ? 1.22 : 1)
      ctx.globalAlpha = ga
      ctx.fillStyle = fillStyle
      ctx.beginPath()
      ctx.arc(px, py, tr, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  if (opts?.speedLines && sp > 32) {
    const ux = vx / sp
    const uy = vy / sp
    const px = -uy
    const py = ux
    ctx.save()
    ctx.lineCap = 'round'
    const n = 8
    const baseLen = r * (1.35 + Math.min(sp / 340, 2.9))
    const vis = Math.min(sp / 750, 1)
    for (let k = 0; k < n; k++) {
      const side = ((k - (n - 1) / 2) * r * 0.21) / Math.max(squash, 0.65)
      const back = r * 0.28
      const sx = x - ux * back + px * side
      const sy = y - uy * back + py * side
      const len = baseLen * (0.5 + (k % 4) * 0.18)
      const ex = sx - ux * len
      const ey = sy - uy * len
      ctx.strokeStyle = `rgba(250, 252, 255, ${0.22 + 0.52 * vis})`
      ctx.lineWidth = 0.85 + vis * 1.45
      ctx.beginPath()
      ctx.moveTo(sx, sy)
      ctx.lineTo(ex, ey)
      ctx.stroke()
    }
    ctx.restore()
  }

  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.scale(stretch, squash)
  ctx.shadowBlur = (brightBall ? 6 : 4) + Math.min(sp / 140, 10)
  ctx.shadowColor = brightBall
    ? 'rgba(100, 160, 255, 0.42)'
    : 'rgba(0, 0, 0, 0.35)'
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fillStyle = fillStyle
  ctx.fill()
  ctx.shadowBlur = 0
  if (stroke) {
    ctx.strokeStyle = strokeStyle
    ctx.lineWidth = lineWidth / Math.sqrt(stretch * squash)
    ctx.stroke()
  }
  ctx.restore()

  if (opts?.redFlames && sp > 120) {
    const ux = vx / sp
    const uy = vy / sp
    const px = -uy
    const py = ux
    const fInt = Math.min((sp - 120) / 400, 1)
    for (let k = 0; k < 6; k++) {
      const spread = (k / 5 - 0.5) * r * 1.05
      ctx.save()
      const ox = x - ux * r * 0.52 + px * spread
      const oy = y - uy * r * 0.52 + py * spread * 0.25
      ctx.translate(ox, oy)
      ctx.rotate(angle + Math.PI)
      const grd = ctx.createLinearGradient(
        0,
        -r * 0.2,
        0,
        r * (1.6 + fInt * 0.6)
      )
      grd.addColorStop(0, `rgba(255, 40, 20, ${0.55 + fInt * 0.3})`)
      grd.addColorStop(0.35, `rgba(255, 100, 30, ${0.35 * fInt + 0.15})`)
      grd.addColorStop(1, 'rgba(255, 220, 120, 0)')
      ctx.fillStyle = grd
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.quadraticCurveTo(r * 0.42, r * 0.75, 0, r * (1.15 + fInt * 0.45))
      ctx.quadraticCurveTo(-r * 0.42, r * 0.75, 0, 0)
      ctx.fill()
      ctx.restore()
    }
  }

  return r * Math.max(stretch, 1 / squash)
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
  const tr = sim.ballTrail
  for (let i = tr.length - 1; i >= 0; i--) {
    const pt = tr[i]
    const prev = i > 0 ? tr[i - 1] : pt
    const u = i / Math.max(1, tr.length - 1)
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
      ctx.fillStyle = `rgba(248, 252, 255, ${alpha * 0.82})`
    }
    const dx = pt.x - prev.x
    const dy = pt.y - prev.y
    const seg = Math.hypot(dx, dy)
    const angle = seg > 0.5 ? Math.atan2(dy, dx) : 0
    const elong = 1 + Math.min(seg / 14, 2.1) * 0.55
    const rad = thick * (0.4 + 0.6 * (1 - u))
    ctx.save()
    ctx.translate(pt.x, pt.y)
    ctx.rotate(angle)
    ctx.scale(elong, 1 / Math.sqrt(elong))
    ctx.beginPath()
    ctx.arc(0, 0, rad, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}

/** Launcher telemetry for dev panel (never drawn on the gameplay canvas). */
function buildLauncherDebugHudLines(
  sim: Sim,
  spinningDiscsEnabled: boolean
): string[] {
  const thetaVisDeg = (sim.theta * 180) / Math.PI
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

  const prim = primaryIncomingForGuidance(sim)
  const idealStr =
    prim != null && prim.idealContactTime > 0
      ? prim.idealContactTime.toFixed(3)
      : '—'
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
  const timingQPreviewStr =
    sim.debugPredictedTimingErrorSec != null
      ? contactQuality01(sim.debugPredictedTimingErrorSec).toFixed(2)
      : '—'
  const timingQHitStr =
    sim.debugTimingErrorSec != null
      ? contactQuality01(sim.debugTimingErrorSec).toFixed(2)
      : '—'
  const pvLine =
    prim != null
      ? `pitch v: ${prim.pitchSpeedNominal.toFixed(0)}  incoming ay: ${prim.pitchIncomingAy.toFixed(0)}  frT: ${prim.pitchContactFracT.toFixed(2)}  relDy: ${prim.pitchReleaseDyPx.toFixed(1)}`
      : 'pitch v: —  (no primary incoming)'
  const lines = [
    `pitch: ${sim.debugPitchHud}  ballRole: ${sim.ballRole}  incoming#: ${sim.incomingPitches.length}  next:${sim.pitchNextIn.toFixed(2)}s  auto:${sim.debugAutoPitch ? 'Y' : 'n'}`,
    pvLine,
    `sweetQ prev: ${sim.debugSweetQPreview.toFixed(2)}  @hit: ${sim.debugSweetQAtContact.toFixed(2)}  batT: ${sim.debugContactAlongT.toFixed(2)}`,
    `xfer: ${sim.debugTransferEff.toFixed(2)}  pullU@hit: ${sim.debugPullbackUAtContact.toFixed(2)}  arm: ${sim.pitchArmElapsed.toFixed(2)}s`,
    `exit prev: ${sim.debugExitBandPreview}  last: ${sim.debugLastExitBand}  g×: ${sim.ballOutgoingGravityMul.toFixed(2)}`,
    `V-band: prev ${sim.debugVerticalBandPreview}  @hit ${sim.debugVerticalBandAtContact}  class: prev ${sim.debugOutcomeClassPreview}  @hit ${sim.debugOutcomeClassAtContact}`,
    `timingQ (0–1): prev ${timingQPreviewStr}  @hit ${timingQHitStr}`,
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
      pred != null
        ? `(${pred.x.toFixed(0)}, ${pred.y.toFixed(0)})`
        : '(—, —)'
    }`,
    `g_in: ${GRAVITY}  g_out: ${OUTGOING_GRAVITY}`,
    `release tier: ${sim.powerTierRelease}  mult: x${scoreMultiplier(sim.powerTierRelease).toFixed(2)}`,
    `ball tier: ${sim.ball ? sim.ballShotTier : '—'}${sim.ball ? `  pierceArmed: ${sim.ballPierceArmed}` : ''}`,
    `charge t: ${sim.chargeElapsed.toFixed(2)}s`,
    sim.ball
      ? `ball v: (${sim.ball.vx.toFixed(0)}, ${sim.ball.vy.toFixed(0)})`
      : 'ball v: —',
  ]
  if (spinningDiscsEnabled) {
    lines.push(
      `hit depth: ${sim.debugHitWinnerLine}`,
      ...sim.debugHitCandidateLines,
      `disc exposed all hit: ${sim.debugAllTargetsTriggered}  (fixed occluder y)`,
      ...sim.rings.map((ring, r) => {
        const layer = r === 0 ? 'front' : r === 1 ? 'mid' : 'back'
        const dir = ring.omega >= 0 ? 'CW' : 'CCW'
        return `ring ${r} (${layer}): ${dir}  ω=${ring.omega.toFixed(2)}  θ=${ring.rotation.toFixed(3)}`
      })
    )
  } else {
    lines.push(
      'spinning discs: OFF (dev) — no collisions, scoring, or disc target updates'
    )
  }

  if (GALLERY_DEBUG_GUIDE_PRE_SHIFT_Y) {
    const guideY = sim.h * GALLERY_FRONT_CY_FR
    lines.unshift(
      `[gallery] pre-shift anchor screen Y ≈ ${guideY.toFixed(1)} (GALLERY_DEBUG_GUIDE_PRE_SHIFT_Y)`
    )
  }

  return lines
}

function nextPitchCadenceInterval(sim: Sim): number {
  const jitter =
    (pitchVariant01(sim.pitchSeq, 77) - 0.5) * 2 * PITCH_CADENCE_JITTER_SEC
  return Math.max(0.14, PITCH_CADENCE_SEC + jitter)
}

/** Fire one pitch from mound toward the planned barrel contact point. */
function trySpawnIncomingPitch(sim: Sim, opts?: { auto?: boolean }): void {
  if (sim.incomingPitches.length >= MAX_INCOMING_PITCHES) return
  sim.pitchSeq += 1
  const seq = sim.pitchSeq
  const variant = pickPitchVariantFields(sim, seq)
  sim.debugAutoPitch = opts?.auto ?? false

  const target = pitchPlannedContactPoint(sim, variant.pitchContactFracT)
  const start = pitchMoundScreenPoint(sim, variant.pitchReleaseDyPx)
  const dx = target.x - start.x
  const dy = target.y - start.y
  const len = Math.hypot(dx, dy) || 1
  const sp = variant.pitchSpeedNominal
  const vx = (dx / len) * sp
  const vy = (dy / len) * sp
  const travelSec =
    Math.abs(vx) > 80 ? (target.x - start.x) / vx : len / sp
  const idealContactTime = sim.simTime + clamp(travelSec, 0.06, 1.35)

  sim.incomingPitches.push({
    ball: {
      x: start.x,
      y: start.y,
      vx,
      vy,
      r: ballRadiusPx(sim) * PITCH_DEPTH_START_R_MUL,
    },
    idealContactTime,
    pitchSpawnSimTime: sim.simTime,
    pitchContactResolved: false,
    pitchContactFracT: variant.pitchContactFracT,
    pitchSpeedNominal: variant.pitchSpeedNominal,
    pitchIncomingAy: variant.pitchIncomingAy,
    pitchReleaseDyPx: variant.pitchReleaseDyPx,
    pitchSeq: seq,
  })
  sim.debugHitCandidateCount = 0
  sim.debugHitWinnerLine = ''
  sim.debugHitCandidateLines = []
}

let lastSpriteThetaLogMs = 0

export function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const simRef = useRef<Sim | null>(null)
  const spritesRef = useRef<LoadedGameSprites | null>(null)
  const devDrawOptionsRef = useRef<DevDrawOptions>({
    clipDiscLowerHalf: false,
    revealHiddenLayers: true,
    showLauncherDebugHud: true,
    showSpriteDebug: false,
    transparencyUnderlayTest: false,
    enableSpinningDiscs: true,
    showSceneLayoutDebug: false,
  })

  const [devToolsOpen, setDevToolsOpen] = useState(false)
  const [clipDiscLowerHalf, setClipDiscLowerHalf] = useState(false)
  const [revealHiddenLayers, setRevealHiddenLayers] = useState(true)
  const [showLauncherDebugHud, setShowLauncherDebugHud] = useState(true)
  const [showSpriteDebug, setShowSpriteDebug] = useState(false)
  const [transparencyUnderlayTest, setTransparencyUnderlayTest] =
    useState(false)
  const [enableSpinningDiscs, setEnableSpinningDiscs] = useState(true)
  const [showSceneLayoutDebug, setShowSceneLayoutDebug] = useState(false)
  const [, setSpritesRevision] = useState(0)
  const boardAspectRef = useRef(FALLBACK_BOARD_ASPECT)
  const [devToolsHostEl, setDevToolsHostEl] = useState<HTMLElement | null>(null)
  const launcherHudPreRef = useRef<HTMLPreElement | null>(null)

  const resize = useCallback(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const frame = readPlayfieldFrameBudgetPx()
    const measureEl = document.getElementById('game-max-fit-rect')
    let vw = measureEl?.clientWidth ?? 0
    let vh = measureEl?.clientHeight ?? 0
    if (vw <= 0 || vh <= 0) {
      vw = Math.max(1, window.innerWidth - 48)
      vh = Math.max(1, window.innerHeight - 48)
    }
    vw = Math.max(1, vw - frame.x)
    vh = Math.max(1, vh - frame.y)

    const aspect = boardAspectRef.current
    let w: number
    let h: number
    if (vw / vh > aspect) {
      h = vh
      w = h * aspect
    } else {
      w = vw
      h = w / aspect
    }

    const dpr = Math.min(window.devicePixelRatio ?? 1, 2)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    canvas.style.backgroundColor = STAGE_VOID_HEX
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)

    container.style.width = `${w}px`
    container.style.height = `${h}px`

    if (!simRef.current) {
      simRef.current = createSim(w, h)
    }
    layoutSim(simRef.current, w, h, spritesRef.current)
    simRef.current.dpr = dpr
    if (devDrawOptionsRef.current.showSceneLayoutDebug) {
      console.debug(
        '[scene] scale',
        simRef.current.sceneLayout.scale.toFixed(4),
        'logical',
        `${w.toFixed(0)}×${h.toFixed(0)}`
      )
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    loadGameSprites()
      .then((loaded) => {
        if (cancelled) return
        spritesRef.current = loaded
        boardAspectRef.current = getStadiumImageAspectRatio(loaded.bg)
        resize()
        setSpritesRevision((n) => n + 1)
      })
      .catch((err) => {
        console.warn('Sprite assets failed to load; using layout fallback.', err)
        spritesRef.current = null
        boardAspectRef.current = FALLBACK_BOARD_ASPECT
        const sim = simRef.current
        if (sim) layoutSim(sim, sim.w, sim.h, null)
        resize()
        setSpritesRevision((n) => n + 1)
      })
    return () => {
      cancelled = true
    }
  }, [resize])

  useEffect(() => {
    resize()
    const ro = new ResizeObserver(() => resize())
    const measureEl = document.getElementById('game-max-fit-rect')
    if (measureEl) ro.observe(measureEl)
    window.addEventListener('resize', resize)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', resize)
    }
  }, [resize])

  useLayoutEffect(() => {
    setDevToolsHostEl(document.getElementById('game-dev-tools-host'))
  }, [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const sim = simRef.current
    if (!canvas || !sim) return

    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    const { w, h, dpr } = sim
    const targetRDraw = targetRadiusPx(sim)
    let sx = 0
    let sy = 0
    if (sim.shakeRemain > 0) {
      const m = 6.5 * (sim.shakeRemain / SHAKE_PERFECT)
      sx = (Math.random() - 0.5) * m * 2
      sy = (Math.random() - 0.5) * m * 2
    }

    const dev = devDrawOptionsRef.current

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(dpr, 0, 0, dpr, sx * dpr, sy * dpr)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.filter = 'none'
    /* Opaque void under the whole logical board so letterboxing / compositor never flashes white. */
    ctx.fillStyle = STAGE_VOID_HEX
    ctx.fillRect(0, 0, w, h)

    /* Dev-only: not a scene background — underlay to verify PNG alpha vs stadium. */
    if (dev.transparencyUnderlayTest) {
      ctx.fillStyle = '#ff0000'
      ctx.fillRect(0, 0, w, h)
    }

    const sprites = spritesRef.current
    if (sprites?.bg) {
      drawBackgroundImage(ctx, sprites.bg, w, h)
    }

    drawReleaseFlash(ctx, sim)

    if (dev.enableSpinningDiscs) {
      const clipWheel =
        dev.clipDiscLowerHalf && !dev.revealHiddenLayers

      const { rings } = sim

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
          drawRingRowTargets(ctx, ring, r, dev.revealHiddenLayers, targetRDraw)
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

        if (dev.revealHiddenLayers) {
          for (let r = RING_COUNT - 1; r >= 0; r--) {
            const ring = rings[r]
            drawFixedOccluderEdgeDebug(ctx, ring)
          }
          drawGalleryRowCenterDebug(ctx, rings)
        }

        for (let r = RING_COUNT - 1; r >= 0; r--) {
          drawRingRowTargets(ctx, rings[r], r, dev.revealHiddenLayers, targetRDraw)
        }
      }

      if (clipWheel) {
        if (dev.revealHiddenLayers) {
          for (let r = RING_COUNT - 1; r >= 0; r--) {
            const ring = rings[r]
            drawFixedOccluderEdgeDebug(ctx, ring)
          }
          drawGalleryRowCenterDebug(ctx, rings)
        }
      }
    } else {
      ctx.save()
      ctx.font = '600 11px ui-monospace, system-ui, monospace'
      ctx.textBaseline = 'bottom'
      const note = 'Disc field disabled'
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'
      ctx.lineWidth = 3
      ctx.strokeText(note, 10, h - 8)
      ctx.fillStyle = 'rgba(255, 205, 130, 0.95)'
      ctx.fillText(note, 10, h - 8)
      ctx.restore()
    }

    drawFloatingCloudLayer(ctx, sim)

    if (sim.spriteLayout) {
      drawAtmosphericBackGlow(
        ctx,
        sim.spriteLayout,
        w,
        h,
        sim.simTime,
        sim.phase,
        sim.omega
      )
    }

    drawGroundContactShadow(ctx, sim)

    drawHittingGuidance(ctx, sim)

    /** Hero glow: Layer B halos → spring (on halos, under crisp sprites) → sprites → shimmer. */
    if (sprites?.statue && sim.spriteLayout) {
      drawStatueSilhouetteHalo(
        ctx,
        sprites.statue,
        sim.spriteLayout,
        sim.simTime,
        sim.phase,
        sim.omega
      )
    }
    if (sprites?.bat && sim.spriteLayout) {
      drawBatSilhouetteHalo(
        ctx,
        sprites.bat,
        sim.spriteLayout,
        sim.theta,
        sim.simTime,
        sim.phase,
        sim.omega
      )
    }
    if (sim.spriteLayout) {
      const sl = sim.spriteLayout
      const handA: Vec2 = {
        x: sl.statueX + sl.statueHandSpringInVisX * sl.statueUniformScale,
        y: sl.statueY + sl.statueHandSpringInVisY * sl.statueUniformScale,
      }
      const hingeTauSec =
        sim.springSwingT0 != null &&
        (sim.phase === 'swing' || sim.phase === 'recovery')
          ? sim.simTime - sim.springSwingT0
          : null
      drawSpring(
        ctx,
        handA,
        sim.pivot,
        {
          phase: sim.phase,
          hingeTauSec,
          batVisPhiRad: sim.theta + sl.batRotDeltaRad,
          batRestPhiRad: THETA_REST + sl.batRotDeltaRad,
          omega: sim.omega,
        },
        Math.min(w, h),
        {
          debug: dev.showSpriteDebug,
          layoutScale: sim.sceneLayout.scale,
        }
      )
    }
    if (sprites?.statue && sim.spriteLayout) {
      drawStatueSprite(ctx, sprites.statue, sim.spriteLayout)
    }

    if (sim.phase === 'charging') {
      drawPowerBar(ctx, sim, sim.pCurrent, 'power', {
        fullSendZoneLive: isFullSendZone(sim.pCurrent),
      })
    } else if (sim.phase === 'swing' || sim.phase === 'recovery') {
      drawPowerBar(ctx, sim, sim.pRelease, '', {
        fullSendLocked: sim.powerTierRelease === 'full_send',
        perfectSendLocked: sim.powerTierRelease === 'perfect_full_send',
      })
    }

    if (sprites?.bat && sim.spriteLayout) {
      drawBatSprite(ctx, sprites.bat, sim.spriteLayout, sim.theta)
    }

    if (sim.spriteLayout) {
      drawHeroShimmer(
        ctx,
        sim.spriteLayout,
        sim.simTime,
        sim.theta,
        sim.phase,
        sim.omega
      )
    }

    for (const inc of sim.incomingPitches) {
      const b = inc.ball
      const fill = '#f2e6d8'
      const stroke = 'rgba(200, 120, 60, 0.75)'
      drawDynamicBall(ctx, b.x, b.y, b.r, b.vx, b.vy, fill, stroke, 2, true)
    }

    if (sim.ball && sim.ballRole === 'outgoing') {
      const b = sim.ball
      drawBallTrail(ctx, sim)
      let fill = '#ffffff'
      let stroke = 'rgba(175, 205, 240, 0.52)'
      let lw = 2
      if (sim.ballExitBand === 'moonshot') {
        fill = '#fffefb'
        stroke = 'rgba(255, 235, 160, 0.98)'
        lw = 3.2
      } else if (sim.ballExitBand === 'power') {
        fill = '#ffffff'
        stroke = 'rgba(255, 200, 130, 0.9)'
        lw = 2.85
      } else if (sim.ballShotTier === 'perfect_full_send') {
        fill = '#ffffff'
        stroke = 'rgba(255, 110, 75, 0.9)'
        lw = 2.45
      } else if (sim.ballShotTier === 'full_send') {
        fill = '#ffffff'
        stroke = 'rgba(255, 155, 85, 0.78)'
        lw = 2.25
      }
      /** Rim always on so a bright white ball stays readable on sky / scoreboard. */
      const strokeOn = true
      const fullPower =
        sim.ballShotTier === 'full_send' ||
        sim.ballShotTier === 'perfect_full_send'
      const tipR = drawDynamicBall(
        ctx,
        b.x,
        b.y,
        b.r,
        b.vx,
        b.vy,
        fill,
        stroke,
        lw,
        strokeOn,
        {
          streakMul: 1.65,
          smearThreshold: 22,
          motionBlurSteps: 7,
          stretchMul: 1.4,
          speedLines: true,
          redFlames: fullPower,
          brightBall: true,
        }
      )
      if (sim.ballExitBand === 'moonshot') {
        ctx.save()
        ctx.font = 'bold 11px system-ui, sans-serif'
        ctx.fillStyle = 'rgba(255, 230, 150, 0.98)'
        ctx.fillText('MOONSHOT', b.x - 34, b.y - tipR - 8)
        ctx.restore()
      } else if (sim.ballExitBand === 'power') {
        ctx.save()
        ctx.font = 'bold 10px system-ui, sans-serif'
        ctx.fillStyle = 'rgba(255, 210, 130, 0.95)'
        ctx.fillText('POWER', b.x - 22, b.y - tipR - 7)
        ctx.restore()
      } else if (sim.ballShotTier === 'perfect_full_send') {
        ctx.save()
        ctx.font = 'bold 10px system-ui, sans-serif'
        ctx.fillStyle = 'rgba(255, 160, 90, 0.95)'
        ctx.fillText('PERFECT SEND', b.x - 38, b.y - tipR - 6)
        ctx.restore()
      } else if (sim.ballShotTier === 'full_send') {
        ctx.save()
        ctx.font = 'bold 10px system-ui, sans-serif'
        ctx.fillStyle = 'rgba(255, 210, 120, 0.9)'
        ctx.fillText('FULL SEND', b.x - 28, b.y - tipR - 6)
        ctx.restore()
      }
    }

    drawRetroScoreboard(
      ctx,
      w,
      h,
      {
        score: sim.score,
        timedMode: sim.timedMode,
        timerRemainingSec: sim.timerRemainingSec,
        comboMultiplier: sim.comboMultiplier,
      },
      sim.sceneLayout.scale
    )

    if (dev.showSceneLayoutDebug) {
      drawSceneLayoutDebug(ctx, sim)
    }

    if (dev.showSpriteDebug && sim.spriteLayout) {
      drawSpriteDebugOverlay(ctx, sim.spriteLayout, sim.theta)
      const now = performance.now()
      if (now - lastSpriteThetaLogMs > 400) {
        lastSpriteThetaLogMs = now
        console.debug(
          '[sprite] theta rad',
          sim.theta.toFixed(4),
          'deg',
          ((sim.theta * 180) / Math.PI).toFixed(1)
        )
      }
    }

    const hudPre = launcherHudPreRef.current
    if (hudPre) {
      if (devDrawOptionsRef.current.showLauncherDebugHud) {
        hudPre.textContent = buildLauncherDebugHudLines(
          sim,
          devDrawOptionsRef.current.enableSpinningDiscs
        ).join('\n')
      } else {
        hudPre.textContent = ''
      }
    }

    if (sim.phase === 'charging' && sim.pointer) {
      canvas.style.cursor = 'grabbing'
    } else if (sim.pointer && nearBat(sim)) {
      canvas.style.cursor = 'grab'
    } else {
      canvas.style.cursor = ''
    }
  }, [])

  useLayoutEffect(() => {
    devDrawOptionsRef.current = {
      clipDiscLowerHalf,
      revealHiddenLayers,
      showLauncherDebugHud,
      showSpriteDebug,
      transparencyUnderlayTest,
      enableSpinningDiscs,
      showSceneLayoutDebug,
    }
    const sim = simRef.current
    const canvas = canvasRef.current
    if (sim && canvas) draw()
  }, [
    clipDiscLowerHalf,
    revealHiddenLayers,
    showLauncherDebugHud,
    showSpriteDebug,
    transparencyUnderlayTest,
    enableSpinningDiscs,
    showSceneLayoutDebug,
    draw,
  ])

  useGameLoop((dt) => {
    const sim = simRef.current
    if (!sim) return

    sim.simTime += dt
    updateFloatingCloudLayer(sim, dt)

    if (
      sim.timedMode &&
      sim.timerRemainingSec != null &&
      sim.timerRemainingSec > 0
    ) {
      sim.timerRemainingSec = Math.max(0, sim.timerRemainingSec - dt)
    }

    const discsOn = devDrawOptionsRef.current.enableSpinningDiscs
    if (discsOn) {
      for (let ri = 0; ri < RING_COUNT; ri++) {
        const ring = sim.rings[ri]
        ring.rotation += ring.omega * dt
      }
      updateDiscTargetStates(sim)
    }
    sim.prevTheta = sim.theta

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
      sim.pitchArmElapsed += dt
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
          sim.springSwingT0 = null
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

    const errPred = predictTimingErrorForPreview(sim)
    const prevPrimary = primaryIncomingForGuidance(sim)
    if (
      errPred != null &&
      prevPrimary != null &&
      ((sim.phase === 'charging' && sim.pointer) ||
        sim.phase === 'swing' ||
        sim.phase === 'recovery')
    ) {
      const pullbackU = sim.phase === 'charging' ? sim.pCurrent : sim.pRelease
      const ixPrev = pitchPlannedContactPoint(
        sim,
        prevPrimary.pitchContactFracT
      )
      const sweetPrev = sweetSpotQuFromT(prevPrimary.pitchContactFracT)
      sim.debugSweetQPreview = sweetPrev
      const outPrev = battedBallOutcome(
        sim,
        errPred,
        ixPrev.x,
        ixPrev.y,
        pullbackU,
        sweetPrev,
        prevPrimary.pitchContactFracT,
        chargeThetaForAimPreview(sim),
        prevPrimary.pitchSeq
      )
      sim.debugExitBandPreview = outPrev.exitBand
      sim.debugPredictedTimingErrorSec = errPred
      if (outPrev.bucket === 'miss') {
        sim.debugPredictedPostHitVel = null
        sim.debugVerticalBandPreview = '—'
        sim.debugOutcomeClassPreview = '—'
      } else {
        sim.debugPredictedPostHitVel = { x: outPrev.vx, y: outPrev.vy }
        sim.debugVerticalBandPreview = outPrev.verticalBand ?? '—'
        sim.debugOutcomeClassPreview = outPrev.outcomeClass ?? '—'
      }
    } else {
      sim.debugPredictedPostHitVel = null
      sim.debugPredictedTimingErrorSec = null
      sim.debugSweetQPreview = 0
      sim.debugExitBandPreview = 'standard'
      sim.debugVerticalBandPreview = '—'
      sim.debugOutcomeClassPreview = '—'
    }

    sim.debugPreviewMatchesActual = false
    sim.debugPitchHud = computePitchHud(sim)

    for (const inc of sim.incomingPitches) {
      const b = inc.ball
      updateIncomingBallDepthRadiusFor(
        sim,
        sim.simTime,
        inc.pitchSpawnSimTime,
        inc.idealContactTime,
        b
      )
      b.vy += inc.pitchIncomingAy * dt
      b.x += b.vx * dt
      b.y += b.vy * dt
    }

    for (const inc of sim.incomingPitches) {
      const b = inc.ball
      applyFloatingTargetHitsForBall(
        sim,
        b,
        Math.max(ballRadiusPx(sim), b.r)
      )
    }

    const primDbg = primaryIncomingForGuidance(sim)
    sim.debugIncomingVel =
      primDbg != null && !primDbg.pitchContactResolved
        ? { x: primDbg.ball.vx, y: primDbg.ball.vy }
        : null

    for (let i = 0; i < sim.incomingPitches.length; i++) {
      const inc = sim.incomingPitches[i]
      const b = inc.ball
      const ix = pitchPlannedContactPoint(sim, inc.pitchContactFracT)
      const thetaHit = sim.theta
      const tipCur = batTip(sim.pivot, sim.batLen, thetaHit)
      const d2 = distSqPointSegment(
        b.x,
        b.y,
        sim.pivot.x,
        sim.pivot.y,
        tipCur.x,
        tipCur.y
      )
      const tAlong = closestTOnBat(
        b.x,
        b.y,
        sim.pivot,
        sim.batLen,
        thetaHit
      )
      const inUpperBarrel = tAlong >= CONTACT_BARREL_T_MIN
      const cz = contactZoneRadiusPx(sim)
      const inZone = d2 <= cz * cz && inUpperBarrel
      const inSwingArc =
        thetaHit <= CONTACT_THETA_EARLY && thetaHit >= CONTACT_THETA_LATE
      const pastPlate =
        b.x > ix.x + designPx(sim.sceneLayout, BALL_PAST_PLATE_DX_DESIGN) &&
        b.vx > 40
      const swingOk =
        (sim.phase === 'swing' || sim.phase === 'recovery') &&
        sim.pRelease > POWER_DEADZONE &&
        inc.idealContactTime > 0

      if (!inc.pitchContactResolved) {
        if (inZone && swingOk && inSwingArc) {
          inc.pitchContactResolved = true
          const err = sim.simTime - inc.idealContactTime
          sim.debugTimingErrorSec = err
          sim.debugSwingCrossTime = sim.batCrossLaunchTime ?? sim.simTime

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
            sweetHit,
            tAlong,
            sim.thetaRelease,
            inc.pitchSeq
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
            b.r = ballRadiusPx(sim)
            sim.ball = b
            sim.ballRole = 'outgoing'
            sim.ballShotTier = out.tier
            sim.ballPierceArmed = out.tier === 'perfect_full_send'
            sim.ballNextHitMinRing = null
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
            if (
              out.tier === 'full_send' ||
              out.tier === 'perfect_full_send'
            ) {
              sim.releaseFlashTier = out.tier
              sim.releaseFlashRemain =
                out.tier === 'perfect_full_send'
                  ? FLASH_PERFECT_SEND
                  : FLASH_FULL_SEND
              if (out.tier === 'perfect_full_send') {
                sim.shakeRemain = Math.max(sim.shakeRemain, SHAKE_PERFECT)
              }
            }
            sim.debugOutgoingVel = { x: out.vx, y: out.vy }
            sim.debugVerticalBandAtContact = out.verticalBand ?? '—'
            sim.debugOutcomeClassAtContact = out.outcomeClass ?? '—'
            const cmp = sim.debugPredictedPostHitVel
            const predE = sim.debugPredictedTimingErrorSec
            sim.debugPreviewMatchesActual =
              cmp != null &&
              predE != null &&
              Math.abs(predE - err) < 0.04 &&
              Math.hypot(cmp.x - out.vx, cmp.y - out.vy) < 55
            sim.incomingPitches.splice(i, 1)
            i--
            sim.skipOutgoingPhysicsOnce = true
          } else {
            sim.debugContactFlash = 0.06
            sim.debugOutgoingVel = null
            sim.debugVerticalBandAtContact = '—'
            sim.debugOutcomeClassAtContact = '—'
          }
          break
        }
      }

      if (pastPlate) {
        sim.incomingPitches.splice(i, 1)
        i--
      }
    }

    for (let i = sim.incomingPitches.length - 1; i >= 0; i--) {
      const inc = sim.incomingPitches[i]
      const b = inc.ball
      const br = Math.max(ballRadiusPx(sim), b.r)
      const oob =
        b.x < -br * 2 ||
        b.x > sim.w + br * 2 ||
        b.y < -br * 2 ||
        b.y > sim.h + br * 2
      if (oob) {
        sim.incomingPitches.splice(i, 1)
      }
    }

    const bOut = sim.ball
    if (bOut && sim.ballRole === 'outgoing') {
      if (sim.skipOutgoingPhysicsOnce) {
        sim.skipOutgoingPhysicsOnce = false
      } else {
        integrateBall(
          bOut,
          OUTGOING_GRAVITY * sim.ballOutgoingGravityMul,
          dt
        )
      }
      sim.ballTrail.unshift({ x: bOut.x, y: bOut.y })
      if (sim.ballTrail.length > TRAIL_MAX) {
        sim.ballTrail.length = TRAIL_MAX
      }

      applyFloatingTargetHitsForBall(sim, bOut, ballRadiusPx(sim))

      let hitRing = -1
      let hitIdx = -1
      if (devDrawOptionsRef.current.enableSpinningDiscs) {
        const resolved = resolveSingleTargetHit(sim, bOut, dt)
        if (resolved != null) {
          hitRing = resolved.ring
          hitIdx = resolved.idx
        }
      } else {
        sim.debugHitCandidateCount = 0
        sim.debugHitWinnerLine = ''
        sim.debugHitCandidateLines = []
      }

      if (hitRing >= 0 && hitIdx >= 0) {
        const tier = sim.ballShotTier
        sim.score += targetPointsForRing(hitRing)

        const struck = sim.rings[hitRing].targetSlots[hitIdx]
        struck.wasTriggered = true
        struck.isActive = false

        if (tier === 'perfect_full_send' && sim.ballPierceArmed) {
          sim.ballPierceArmed = false
          sim.ballNextHitMinRing = Math.min(hitRing + 1, RING_COUNT)
          bOut.vx *= PIERCE_SPEED_MUL
          bOut.vy *= PIERCE_SPEED_MUL
          console.log('hit (pierce — perfect full send)')
        } else if (tier === 'full_send') {
          chainDestroyNeighbors(sim, hitRing, hitIdx)
          sim.ball = null
          sim.ballTrail = []
          sim.ballRole = 'none'
          console.log('hit (full send + chain)')
        } else {
          sim.ball = null
          sim.ballTrail = []
          sim.ballRole = 'none'
          console.log('hit')
        }
        refreshTargetActiveFlags(sim)
      } else if (
        bOut.x < -ballRadiusPx(sim) * 2 ||
        bOut.x > sim.w + ballRadiusPx(sim) * 2 ||
        bOut.y < -ballRadiusPx(sim) * 2 ||
        bOut.y > sim.h + ballRadiusPx(sim) * 2
      ) {
        sim.ball = null
        sim.ballTrail = []
        sim.ballRole = 'none'
      }
    } else {
      sim.debugHitCandidateCount = 0
      sim.debugHitWinnerLine = ''
      sim.debugHitCandidateLines = []
    }

    if (sim.ball == null) {
      sim.ballOutgoingGravityMul = 1
      sim.ballExitBand = 'standard'
      sim.ballNextHitMinRing = null
    }

    sim.pitchNextIn -= dt
    if (sim.pitchNextIn <= 0) {
      if (sim.incomingPitches.length < MAX_INCOMING_PITCHES) {
        trySpawnIncomingPitch(sim)
      }
      sim.pitchNextIn += nextPitchCadenceInterval(sim)
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
      sim.springSwingT0 = null
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
      sim.springSwingT0 = null
      sim.chargeElapsed = 0
      sim.pCurrent = 0
      sim.pRelease = 0
      sim.powerTierRelease = 'normal'
      sim.releaseFlashTier = null
      sim.releaseFlashRemain = 0
      sim.pitchArmElapsed = 0
    } else {
      sim.powerTierRelease = classifyPowerTier(sim.pRelease)
      sim.phase = 'swing'
      sim.springSwingT0 = sim.simTime
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
      sim.springSwingT0 = null
      sim.chargeElapsed = 0
      sim.pCurrent = 0
      sim.pRelease = 0
      sim.powerTierRelease = 'normal'
      sim.releaseFlashTier = null
      sim.releaseFlashRemain = 0
      sim.pitchArmElapsed = 0
    }
    sim.pointer = null
    const c = canvasRef.current
    if (c) c.style.cursor = ''
    draw()
  }

  const devToolsPanel = (
    <div
      className="game-dev-tools"
      style={{
        fontFamily: 'ui-monospace, monospace',
        fontSize: 9,
        lineHeight: 1.25,
        color: '#c8d0d8',
        userSelect: 'none',
      }}
    >
      <button
        type="button"
        onClick={() => setDevToolsOpen((o) => !o)}
        style={{
          cursor: 'pointer',
          padding: '3px 8px',
          borderRadius: 4,
          border: '1px solid rgba(196,206,212,0.28)',
          background: 'rgba(12,44,86,0.92)',
          color: '#e8eef2',
          font: 'inherit',
          fontSize: 9,
        }}
      >
        {devToolsOpen ? '▼ Dev' : '▶ Dev'}
      </button>
      <pre
        ref={launcherHudPreRef}
        className="game-launcher-hud-pre"
        style={{
          display: showLauncherDebugHud ? 'block' : 'none',
          marginTop: 6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      />
      {devToolsOpen && (
        <div
          style={{
            marginTop: 5,
            padding: '6px 8px',
            borderRadius: 6,
            border: '1px solid rgba(196,206,212,0.2)',
            background: 'rgba(8,14,24,0.96)',
            maxWidth: 280,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          <div
            style={{
              fontWeight: 600,
              marginBottom: 5,
              opacity: 0.92,
              fontSize: 9,
            }}
          >
            Visibility
          </div>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              marginBottom: 4,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={enableSpinningDiscs}
              onChange={(e) => setEnableSpinningDiscs(e.target.checked)}
            />
            Spinning discs
          </label>
          <div
            style={{
              fontSize: 8,
              opacity: 0.62,
              margin: '-1px 0 6px 18px',
              lineHeight: 1.3,
            }}
          >
            Off: no disc draw / hits / score. Other play continues.
          </div>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              marginBottom: 4,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={clipDiscLowerHalf}
              onChange={(e) => setClipDiscLowerHalf(e.target.checked)}
            />
            Clip wheel (lip)
          </label>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              marginBottom: 4,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={revealHiddenLayers}
              onChange={(e) => setRevealHiddenLayers(e.target.checked)}
            />
            Reveal hidden layers
          </label>
          <div
            style={{
              fontSize: 8,
              opacity: 0.62,
              margin: '-1px 0 6px 18px',
              lineHeight: 1.3,
            }}
          >
            Full disc + occluder line + peg labels.
          </div>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={showLauncherDebugHud}
              onChange={(e) => setShowLauncherDebugHud(e.target.checked)}
            />
            Launcher telemetry (off-canvas)
          </label>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              marginTop: 4,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={showSpriteDebug}
              onChange={(e) => setShowSpriteDebug(e.target.checked)}
            />
            Sprite debug (θ / bbox)
          </label>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              marginTop: 4,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={showSceneLayoutDebug}
              onChange={(e) => setShowSceneLayoutDebug(e.target.checked)}
            />
            Scene layout debug (scale / anchors)
          </label>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              marginTop: 4,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={transparencyUnderlayTest}
              onChange={(e) => setTransparencyUnderlayTest(e.target.checked)}
            />
            Transparency test
          </label>
        </div>
      )}
    </div>
  )

  return (
    <>
      <div
        ref={containerRef}
        style={{
          display: 'block',
          position: 'relative',
          flexShrink: 0,
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
      </div>
      {devToolsHostEl ? createPortal(devToolsPanel, devToolsHostEl) : null}
    </>
  )
}
