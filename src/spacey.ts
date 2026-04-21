/**
 * Spacey bonus target: drawn between field2 and field1 (behind `field1`). Pops up periodically.
 * Hit → all scoring ×2 for {@link SPACEY_DOUBLE_SEC} seconds.
 */
import { circlesOverlap, type Ball } from './physics'
import { designPx, DESIGN_REF_W, type SceneLayout } from './sceneLayout'
import {
  drawSpaceyOrangeRadialHalo,
  SPACEY_ORANGE_GLOW_SHADOW,
  spaceySpriteShadowBlurPx,
} from './targetSpriteGlow'

export const SPACEY_DOUBLE_SEC = 30
export const SPACEY_ANNOUNCE_SEC = 3.4
/** After a hit: flash + orbit text, then lower. */
export const SPACEY_CELEBRATE_SEC = 2.45

export type SpaceyPhase = 'wait' | 'rise' | 'hold' | 'celebrate' | 'lower'

/**
 * Field `field1` scoreboard pocket (design px on 2048-wide art): horizontal band for spawns.
 * Scales with logical canvas width so resize stays aligned with painted board.
 */
const SPACEY_FIELD_SPAWN_X_MIN_FR = 400 / DESIGN_REF_W
const SPACEY_FIELD_SPAWN_X_MAX_FR = 1100 / DESIGN_REF_W
/**
 * Vertical anchor (sprite center at full emerge): upper band so the figure reads above the
 * painted scoreboard; bottom stays occluded by `field1` (same hide-drop as other spawns).
 */
const SPACEY_FIELD_ANCHOR_Y_MIN_FR = 0.14
const SPACEY_FIELD_ANCHOR_Y_MAX_FR = 0.27
/** Hide-drop scale vs right spawn — tune if feet read too high/low behind field1. */
const SPACEY_FIELD_HIDE_DROP_MUL = 1

/**
 * Right-side Spacey: fixed anchor. Left: only in the stadium “gap” band; random tilt
 * reads as peeking from the wall.
 */
const SPACEY_RIGHT_ANCHOR_X_FR = 0.54
const SPACEY_RIGHT_ANCHOR_Y_FR = 0.42
const SPACEY_RIGHT_NUDGE_X_PX = 50

/**
 * Left gap horizontal band (fraction of canvas width). Hard cap: sprite base X must stay
 * within the left fifth of the screen (see {@link clampLeftSpaceyBaseX}).
 */
const SPACEY_LEFT_ANCHOR_X_MIN_FR = 0.06
const SPACEY_LEFT_ANCHOR_X_MAX_FR = 0.16
/** Max (anchor×W + nudge) / W for left spawns — “not past the first fifth” from the left. */
const SPACEY_LEFT_MAX_CENTER_X_FR = 0.2
/**
 * Vertical band (fraction of canvas height; larger Y = lower on screen).
 * Shifted down from 0.28–0.42 — left pocket reads better when he sits lower in the gap.
 */
const SPACEY_LEFT_ANCHOR_Y_MIN_FR = 0.36
const SPACEY_LEFT_ANCHOR_Y_MAX_FR = 0.5
const SPACEY_LEFT_NUDGE_X_MIN = -28
const SPACEY_LEFT_NUDGE_X_MAX = 12
/** Max |rotation| (rad) when peeking from the wall on the left. */
const SPACEY_LEFT_PEEK_RAD_MAX = 0.34

/** Left: scale hide-drop vs right so the rise arc sits lower in the pocket (still eases to anchor Y). */
const SPACEY_LEFT_HIDE_DROP_MUL = 0.72

const SPACEY_HIDE_DROP_DESIGN = 155
const SPACEY_DRAW_W_DESIGN = 210
const SPACEY_ORBIT_R_DESIGN = 132

/**
 * Hits only two small regions in **sprite-local space** (origin = sprite center,
 * +X right, +Y down), then rotated with `spaceyPeekRad`. Tune FRs against `spacey.webp`.
 */
const SPACEY_HEAD_LX_FR = 0
const SPACEY_HEAD_LY_FR = -0.36
const SPACEY_HEAD_R_FR = 0.082

/** Target / bullseye sign (typically beside head in art). */
const SPACEY_SIGN_LX_FR = 0.15
const SPACEY_SIGN_LY_FR = -0.11
const SPACEY_SIGN_R_FR = 0.068

const SPACEY_RISE_SEC = 0.4
/** Full-emerge plateau: 2× previous so Spacey stays on screen twice as long before lowering. */
const SPACEY_HOLD_SEC = 4.7
const SPACEY_LOWER_SEC = 0.38
const SPACEY_WAIT_MIN = 4.5
const SPACEY_WAIT_MAX = 10.5

function randRange(a: number, b: number): number {
  return a + Math.random() * (b - a)
}

function clamp01(u: number): number {
  return Math.max(0, Math.min(1, u))
}

function smoothstep01(u: number): number {
  const t = clamp01(u)
  return t * t * (3 - 2 * t)
}

function clampLeftSpaceyBaseX(sim: SpaceySimFields): void {
  const maxCx = sim.w * SPACEY_LEFT_MAX_CENTER_X_FR
  let bx = sim.w * sim.spaceyAnchorXFr + sim.spaceyNudgeX
  if (bx <= maxCx) return
  sim.spaceyNudgeX = Math.max(
    SPACEY_LEFT_NUDGE_X_MIN,
    Math.min(SPACEY_LEFT_NUDGE_X_MAX, maxCx - sim.w * sim.spaceyAnchorXFr)
  )
  bx = sim.w * sim.spaceyAnchorXFr + sim.spaceyNudgeX
  if (bx > maxCx) {
    sim.spaceyAnchorXFr = Math.max(
      SPACEY_LEFT_ANCHOR_X_MIN_FR,
      (maxCx - sim.spaceyNudgeX) / sim.w
    )
  }
}

function pickSpaceySpawn(sim: SpaceySimFields): void {
  sim.spaceySpawnCycle += 1
  const u = Math.random()

  /** Occasional spawn into the painted scoreboard strip on `field1` (x ~400–1100 @ 2048 ref). */
  if (u < 1 / 3) {
    sim.spaceySpawnIsFieldScoreboard = true
    sim.spaceySpawnIsLeft = false
    sim.spaceyNudgeX = 0
    sim.spaceyAnchorXFr = randRange(
      SPACEY_FIELD_SPAWN_X_MIN_FR,
      SPACEY_FIELD_SPAWN_X_MAX_FR
    )
    sim.spaceyAnchorYFr = randRange(
      SPACEY_FIELD_ANCHOR_Y_MIN_FR,
      SPACEY_FIELD_ANCHOR_Y_MAX_FR
    )
    sim.spaceyPeekRad = randRange(-0.14, 0.14)
    return
  }

  const leftGap = u < 2 / 3
  sim.spaceySpawnIsFieldScoreboard = false
  if (leftGap) {
    sim.spaceySpawnIsLeft = true
    sim.spaceyAnchorXFr = randRange(
      SPACEY_LEFT_ANCHOR_X_MIN_FR,
      SPACEY_LEFT_ANCHOR_X_MAX_FR
    )
    sim.spaceyAnchorYFr = randRange(
      SPACEY_LEFT_ANCHOR_Y_MIN_FR,
      SPACEY_LEFT_ANCHOR_Y_MAX_FR
    )
    sim.spaceyNudgeX = randRange(SPACEY_LEFT_NUDGE_X_MIN, SPACEY_LEFT_NUDGE_X_MAX)
    sim.spaceyPeekRad = randRange(-SPACEY_LEFT_PEEK_RAD_MAX, SPACEY_LEFT_PEEK_RAD_MAX)
    clampLeftSpaceyBaseX(sim)
  } else {
    sim.spaceySpawnIsLeft = false
    sim.spaceyAnchorXFr = SPACEY_RIGHT_ANCHOR_X_FR
    sim.spaceyAnchorYFr = SPACEY_RIGHT_ANCHOR_Y_FR
    sim.spaceyNudgeX = SPACEY_RIGHT_NUDGE_X_PX
    sim.spaceyPeekRad = 0
  }
}

function getSpaceySpriteLayout(
  sim: SpaceySimFields,
  img: HTMLImageElement
): { cx: number; cy: number; w: number; h: number } | null {
  if (img.naturalWidth < 1) return null
  /* Lower than hit gate so he appears a few frames before collisions count. */
  if (sim.spaceyEmerge01 < 0.04) return null
  const { x: cx, y: cy } = spaceyScreenCenter(sim)
  const drawW0 = designPx(sim.sceneLayout, SPACEY_DRAW_W_DESIGN)
  const drawH0 = (drawW0 * img.naturalHeight) / img.naturalWidth
  const popScale = 0.86 + 0.14 * sim.spaceyEmerge01
  return { cx, cy, w: drawW0 * popScale, h: drawH0 * popScale }
}

function spriteLocalToWorld(
  lx: number,
  ly: number,
  cx: number,
  cy: number,
  rad: number
): { x: number; y: number } {
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return { x: cx + lx * c - ly * s, y: cy + lx * s + ly * c }
}

/** Head + sign circles in world space (matches draw transform). */
function getSpaceyHitZones(
  sim: SpaceySimFields,
  img: HTMLImageElement
): { x: number; y: number; r: number }[] {
  const lay = getSpaceySpriteLayout(sim, img)
  if (!lay) return []
  const { cx, cy, w, h } = lay
  const m = Math.max(1, Math.min(w, h))
  const rad = sim.spaceyPeekRad

  const headLx = SPACEY_HEAD_LX_FR * w
  const headLy = SPACEY_HEAD_LY_FR * h
  const headR = Math.max(6, SPACEY_HEAD_R_FR * m)
  const headW = spriteLocalToWorld(headLx, headLy, cx, cy, rad)

  const signLx = SPACEY_SIGN_LX_FR * w
  const signLy = SPACEY_SIGN_LY_FR * h
  const signR = Math.max(5, SPACEY_SIGN_R_FR * m)
  const signW = spriteLocalToWorld(signLx, signLy, cx, cy, rad)

  return [
    { x: headW.x, y: headW.y, r: headR },
    { x: signW.x, y: signW.y, r: signR },
  ]
}

function ballHitsSpaceyZones(
  bx: number,
  by: number,
  br: number,
  prev: { x: number; y: number } | null,
  zones: { x: number; y: number; r: number }[]
): boolean {
  const hitOne = (px: number, py: number, pr: number) => {
    for (const z of zones) {
      if (circlesOverlap(px, py, pr, z.x, z.y, z.r)) return true
    }
    return false
  }
  if (hitOne(bx, by, br)) return true
  if (prev == null) return false
  const dx = bx - prev.x
  const dy = by - prev.y
  const dist = Math.hypot(dx, dy)
  if (dist < 0.5) return false
  const stepPx = Math.max(5, br * 0.75)
  const steps = Math.min(16, Math.max(4, Math.ceil(dist / stepPx)))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = prev.x + dx * t
    const y = prev.y + dy * t
    if (hitOne(x, y, br)) return true
  }
  return false
}

export type SpaceySimFields = {
  w: number
  h: number
  sceneLayout: SceneLayout
  /** Used for celebration flash / orbit animation. */
  simTime: number
  comboMultiplier: number
  scorePointMultiplier: number
  spaceyWaitRemain: number
  spaceyPhase: SpaceyPhase
  spaceyPhaseT: number
  spaceyEmerge01: number
  spaceyHitThisCycle: boolean
  spaceyAnchorXFr: number
  spaceyAnchorYFr: number
  spaceyNudgeX: number
  /** True when this popup uses the left gap (peek rotation). */
  spaceySpawnIsLeft: boolean
  /** Upper `field1` scoreboard strip (design-tied X band); bottom occluded by `field1`. */
  spaceySpawnIsFieldScoreboard: boolean
  /** Rotation (rad) around sprite center; left spawns only. */
  spaceyPeekRad: number
  /** Post-hit celebration time before lowering (`celebrate` phase). */
  spaceyCelebrateRemain: number
  /** Increments each spawn (legacy / debug). */
  spaceySpawnCycle: number
  allPointsDoubleRemainSec: number
  allPointsDoubleAnnounceRemainSec: number
}

export function initSpacey(sim: SpaceySimFields): void {
  sim.spaceyWaitRemain = randRange(SPACEY_WAIT_MIN, SPACEY_WAIT_MAX)
  sim.spaceyPhase = 'wait'
  sim.spaceyPhaseT = 0
  sim.spaceyEmerge01 = 0
  sim.spaceyHitThisCycle = false
  sim.spaceyAnchorXFr = SPACEY_RIGHT_ANCHOR_X_FR
  sim.spaceyAnchorYFr = SPACEY_RIGHT_ANCHOR_Y_FR
  sim.spaceyNudgeX = SPACEY_RIGHT_NUDGE_X_PX
  sim.spaceySpawnIsLeft = false
  sim.spaceySpawnIsFieldScoreboard = false
  sim.spaceyPeekRad = 0
  sim.spaceyCelebrateRemain = 0
  sim.spaceySpawnCycle = 0
  sim.allPointsDoubleRemainSec = 0
  sim.allPointsDoubleAnnounceRemainSec = 0
  sim.scorePointMultiplier = 1
  sim.comboMultiplier = 1
}

export function spaceyScreenCenter(sim: SpaceySimFields): { x: number; y: number } {
  const bx = sim.w * sim.spaceyAnchorXFr + sim.spaceyNudgeX
  const byVisible = sim.h * sim.spaceyAnchorYFr
  let drop =
    designPx(sim.sceneLayout, SPACEY_HIDE_DROP_DESIGN) * (1 - sim.spaceyEmerge01)
  if (sim.spaceySpawnIsLeft) {
    drop *= SPACEY_LEFT_HIDE_DROP_MUL
  } else if (sim.spaceySpawnIsFieldScoreboard) {
    drop *= SPACEY_FIELD_HIDE_DROP_MUL
  }
  return { x: bx, y: byVisible + drop }
}

export function updateSpacey(sim: SpaceySimFields, dt: number): void {
  if (sim.allPointsDoubleRemainSec > 0) {
    sim.allPointsDoubleRemainSec = Math.max(0, sim.allPointsDoubleRemainSec - dt)
  }
  const doubleOn = sim.allPointsDoubleRemainSec > 0
  sim.scorePointMultiplier = doubleOn ? 2 : 1
  sim.comboMultiplier = doubleOn ? 2 : 1

  if (sim.allPointsDoubleAnnounceRemainSec > 0) {
    sim.allPointsDoubleAnnounceRemainSec = Math.max(
      0,
      sim.allPointsDoubleAnnounceRemainSec - dt
    )
  }

  switch (sim.spaceyPhase) {
    case 'wait': {
      sim.spaceyWaitRemain -= dt
      sim.spaceyEmerge01 = 0
      if (sim.spaceyWaitRemain <= 0) {
        pickSpaceySpawn(sim)
        sim.spaceyPhase = 'rise'
        sim.spaceyPhaseT = 0
        sim.spaceyHitThisCycle = false
      }
      break
    }
    case 'rise': {
      sim.spaceyPhaseT += dt
      const u = sim.spaceyPhaseT / Math.max(1e-4, SPACEY_RISE_SEC)
      sim.spaceyEmerge01 = smoothstep01(u)
      if (u >= 1) {
        sim.spaceyPhase = 'hold'
        sim.spaceyPhaseT = 0
        sim.spaceyEmerge01 = 1
      }
      break
    }
    case 'hold': {
      sim.spaceyEmerge01 = 1
      sim.spaceyPhaseT += dt
      if (sim.spaceyPhaseT >= SPACEY_HOLD_SEC && !sim.spaceyHitThisCycle) {
        sim.spaceyPhase = 'lower'
        sim.spaceyPhaseT = 0
      }
      break
    }
    case 'celebrate': {
      sim.spaceyEmerge01 = 1
      sim.spaceyCelebrateRemain -= dt
      if (sim.spaceyCelebrateRemain <= 0) {
        sim.spaceyPhase = 'lower'
        sim.spaceyPhaseT = 0
      }
      break
    }
    case 'lower': {
      sim.spaceyPhaseT += dt
      const u = sim.spaceyPhaseT / Math.max(1e-4, SPACEY_LOWER_SEC)
      sim.spaceyEmerge01 = smoothstep01(1 - u)
      if (u >= 1) {
        sim.spaceyPhase = 'wait'
        sim.spaceyWaitRemain = randRange(SPACEY_WAIT_MIN, SPACEY_WAIT_MAX)
        sim.spaceyEmerge01 = 0
        sim.spaceyHitThisCycle = false
        sim.spaceyCelebrateRemain = 0
      }
      break
    }
    default:
      break
  }
}

export function applySpaceyBallHit(
  sim: SpaceySimFields,
  ball: Ball,
  ballR: number,
  spaceyImg: HTMLImageElement | null,
  ballPrev: { x: number; y: number } | null
): boolean {
  if (!spaceyImg || spaceyImg.naturalWidth < 1) return false
  if (sim.spaceyHitThisCycle) return false
  if (sim.spaceyEmerge01 < 0.12) return false

  const br = Math.max(ballR, ball.r)
  const zones = getSpaceyHitZones(sim, spaceyImg)
  if (zones.length === 0) return false
  if (!ballHitsSpaceyZones(ball.x, ball.y, br, ballPrev, zones)) return false

  sim.spaceyHitThisCycle = true
  sim.allPointsDoubleRemainSec = SPACEY_DOUBLE_SEC
  /* Orbit + scoreboard carry the message; skip disconnected top banner. */
  sim.allPointsDoubleAnnounceRemainSec = 0
  sim.scorePointMultiplier = 2
  sim.comboMultiplier = 2
  sim.spaceyCelebrateRemain = SPACEY_CELEBRATE_SEC
  sim.spaceyPhase = 'celebrate'
  sim.spaceyPhaseT = 0
  return true
}

export function drawSpacey(
  ctx: CanvasRenderingContext2D,
  sim: SpaceySimFields,
  spaceyImg: HTMLImageElement | null,
  /** Post-hit sprite; same pose slot as `spaceyImg`. Flash / orbit use celebration timing. */
  spaceyHitImg: HTMLImageElement | null = null
): void {
  if (!spaceyImg || spaceyImg.naturalWidth < 1) return
  if (sim.spaceyEmerge01 < 0.02) return

  const celebrating = sim.spaceyCelebrateRemain > 0
  const drawImg =
    celebrating &&
    spaceyHitImg &&
    spaceyHitImg.naturalWidth > 0
      ? spaceyHitImg
      : spaceyImg

  const lay = getSpaceySpriteLayout(sim, drawImg)
  if (!lay) return
  const { cx, cy, w, h } = lay
  const flashOn =
    celebrating && Math.floor(sim.simTime * 15) % 2 === 0
  const emergeA = 0.08 + 0.92 * sim.spaceyEmerge01

  drawSpaceyOrangeRadialHalo(ctx, cx, cy, Math.max(w, h) * 0.44, emergeA)

  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(sim.spaceyPeekRad)
  ctx.globalAlpha = emergeA
  if (flashOn) {
    ctx.filter = 'brightness(1.75) saturate(1.15)'
  }
  ctx.shadowColor = SPACEY_ORANGE_GLOW_SHADOW
  ctx.shadowBlur = spaceySpriteShadowBlurPx(Math.max(w, h))
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
  ctx.drawImage(drawImg, -w / 2, -h / 2, w, h)
  ctx.restore()
}

/** Circling copy tied to Spacey after a hit (call after `drawSpacey`, same layer). */
export function drawSpaceyCelebrationOverlays(
  ctx: CanvasRenderingContext2D,
  sim: SpaceySimFields
): void {
  if (sim.spaceyCelebrateRemain <= 0 || sim.spaceyEmerge01 < 0.04) return
  const { x: cx, y: cy } = spaceyScreenCenter(sim)
  const s = Math.max(0.25, sim.sceneLayout.scale)
  const R = designPx(sim.sceneLayout, SPACEY_ORBIT_R_DESIGN)
  const lineA = `${Math.round(SPACEY_DOUBLE_SEC)} SEC`
  const lineB = 'ALL POINTS 2×'
  const t = sim.simTime * 2.05

  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const fontPx = Math.max(9, Math.round(11.5 * s))
  ctx.font = `800 ${fontPx}px "Oswald", "Arial Narrow", system-ui, sans-serif`

  for (let k = 0; k < 2; k++) {
    const ang = t + k * Math.PI
    const ox = cx + Math.cos(ang) * R
    const oy = cy + Math.sin(ang) * R
    ctx.save()
    ctx.translate(ox, oy)
    ctx.rotate(ang + Math.PI / 2)
    ctx.lineWidth = Math.max(2, 3 * s)
    ctx.strokeStyle = 'rgba(0,0,0,0.62)'
    ctx.fillStyle = 'rgba(255, 245, 160, 0.98)'
    ctx.strokeText(lineA, 0, -fontPx * 0.55)
    ctx.fillText(lineA, 0, -fontPx * 0.55)
    ctx.font = `700 ${Math.max(8, Math.round(10 * s))}px "Oswald", system-ui, sans-serif`
    ctx.strokeText(lineB, 0, fontPx * 0.55)
    ctx.fillText(lineB, 0, fontPx * 0.55)
    ctx.restore()
  }

  ctx.strokeStyle = 'rgba(255, 220, 90, 0.35)'
  ctx.lineWidth = Math.max(1.5, 2 * s)
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

export function drawAllPointsDoubleAnnouncement(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  announceRemainSec: number,
  layoutScale: number
): void {
  if (announceRemainSec <= 0) return
  const s = Math.max(0.2, layoutScale)
  const u = clamp01(announceRemainSec / SPACEY_ANNOUNCE_SEC)
  const alpha = Math.min(1, u * 3) * (0.35 + 0.65 * clamp01(u * 1.8))

  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const line1 = 'ALL POINTS DOUBLE'
  const line2 = `${Math.round(SPACEY_DOUBLE_SEC)} SEC`
  const px1 = Math.max(14, Math.round(26 * s))
  const px2 = Math.max(11, Math.round(15 * s))
  ctx.font = `800 ${px1}px "Bebas Neue", Impact, "Arial Narrow", sans-serif`
  ctx.lineWidth = Math.max(2, 4 * s)
  ctx.strokeStyle = `rgba(0,0,0,${0.55 * alpha})`
  ctx.fillStyle = `rgba(255, 248, 210, ${0.97 * alpha})`
  const cy = h * 0.2
  ctx.strokeText(line1, w * 0.5, cy - px2 * 0.35)
  ctx.fillText(line1, w * 0.5, cy - px2 * 0.35)
  ctx.font = `700 ${px2}px "Oswald", system-ui, sans-serif`
  ctx.lineWidth = Math.max(1, 2 * s)
  ctx.strokeStyle = `rgba(0,0,0,${0.45 * alpha})`
  ctx.fillStyle = `rgba(180, 255, 210, ${0.92 * alpha})`
  ctx.strokeText(line2, w * 0.5, cy + px1 * 0.42)
  ctx.fillText(line2, w * 0.5, cy + px1 * 0.42)
  ctx.restore()
}
