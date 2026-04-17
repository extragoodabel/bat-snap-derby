/**
 * Reusable windup sprite loop for the mound pitcher (Mariano Rivera frames).
 * WebP-only loads; anchor is foot on mound — no per-frame centering.
 */

import {
  measureOpaqueBounds,
  type OpaqueBounds,
} from './spriteOpaqueBounds'

/** Mound foot position (fraction of logical canvas). */
export const PITCHER_ANCHOR_X_FR = 0.5
export const PITCHER_ANCHOR_Y_FR = 0.64

/** Target max opaque silhouette height vs canvas height (uniform scale from this). */
export const PITCHER_HEIGHT_FR = 0.17

/** Move pitcher, shadow, and mound spawn together (−X left, +X right). */
export const PITCHER_HORIZONTAL_GROUP_NUDGE_X_PX = -3
/** Nudge after anchor + scale (logical canvas px): +X right, +Y down. */
const PITCHER_OFFSET_X_PX = -26 + PITCHER_HORIZONTAL_GROUP_NUDGE_X_PX
/** Move pitcher, shadow, and WebP release spawn together (+Y down, −Y up). */
export const PITCHER_VERTICAL_GROUP_NUDGE_Y_PX = -48
const PITCHER_OFFSET_Y_PX = 169 + PITCHER_VERTICAL_GROUP_NUDGE_Y_PX

/**
 * 18-step loop (0-based texture indices → mariano1…5). Long holds on M1 / M5 so the loop
 * stays in sync with pitch cadence (was ~2× fast with the old 9-step / 0.55s loop).
 * M1×3, M2, M3, M4 (release), M5×4, M1×8.
 */
export const PITCHER_FRAME_SEQUENCE = [
  0, 0, 0, 1, 2, 3, 4, 4, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0,
] as const

/** mariano4 (release / top of throw) = texture index 3. */
export const PITCHER_RELEASE_TEXTURE_INDEX = 3

/** Step in `PITCHER_FRAME_SEQUENCE` (0-based) where `PITCHER_RELEASE_TEXTURE_INDEX` is shown. */
export const PITCHER_RELEASE_STEP_INDEX = 5

/** Total loop length — 2× the old 0.55s so per-step dwell matches the prior 9-step timing. */
export const PITCHER_LOOP_DURATION_SEC = 1.1

const STEP_SEC =
  PITCHER_LOOP_DURATION_SEC / PITCHER_FRAME_SEQUENCE.length

/** Paths tried in order (`public/` → `/assets/...`). Covers common export naming. */
function pitcherFrameUrlCandidates(frameOneBased: 1 | 2 | 3 | 4 | 5): readonly string[] {
  const n = String(frameOneBased)
  const b = '/assets/pitcher/'
  return [
    `${b}mariano${n}.webp`,
    `${b}mariano${n}.WEBP`,
    `${b}Mariano${n}.webp`,
    `${b}Mariano${n}.WEBP`,
    `${b}MARIANO${n}.webp`,
    `${b}mariano%20${n}.webp`,
    `${b}Mariano%20${n}.webp`,
    `${b}mariano-${n}.webp`,
    `${b}mariano_${n}.webp`,
  ] as const
}

const FRAME_URLS: readonly (readonly string[])[] = [
  pitcherFrameUrlCandidates(1),
  pitcherFrameUrlCandidates(2),
  pitcherFrameUrlCandidates(3),
  pitcherFrameUrlCandidates(4),
  pitcherFrameUrlCandidates(5),
]

export type PitcherAnimMode = 'idleLoop' | 'release' | 'hidden'

export type PitcherPack = {
  frames: readonly HTMLImageElement[]
  /** Foot in full-image natural pixels (shared by all frames — from frame 1 opaque bottom-center). */
  footNatX: number
  footNatY: number
  /** max(opaque height) across frames — uniform scale divisor. */
  refOpaqueHMax: number
  /** Per-frame opaque bounds in natural pixels (spawn / hand uses release frame). */
  bounds: readonly OpaqueBounds[]
}

function loadImageFirstMatch(urls: readonly string[]): Promise<HTMLImageElement> {
  const tryUrl = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image()
      im.decoding = 'async'
      im.onload = () => resolve(im)
      im.onerror = () => reject(new Error(src))
      im.src = src
    })

  return urls.reduce<Promise<HTMLImageElement>>(
    (chain, src) => chain.catch(() => tryUrl(src)),
    Promise.reject(new Error('no-url'))
  )
}

async function loadImageDecoded(urls: readonly string[]): Promise<HTMLImageElement> {
  const im = await loadImageFirstMatch(urls)
  if (im.decode) {
    try {
      await im.decode()
    } catch {
      /* optional */
    }
  }
  return im
}

function opaqueH(b: OpaqueBounds): number {
  return Math.max(0, b.maxY - b.minY)
}

/**
 * Preload all pitcher WebP frames. Returns null if any frame fails (game runs without pitcher).
 */
export async function loadPitcherPack(): Promise<PitcherPack | null> {
  try {
    const frames = await Promise.all(
      FRAME_URLS.map((urls) => loadImageDecoded(urls))
    )
    const bounds = frames.map((im) => measureOpaqueBounds(im))
    let refOpaqueHMax = 1
    for (const b of bounds) {
      refOpaqueHMax = Math.max(refOpaqueHMax, opaqueH(b))
    }
    const b0 = bounds[0]!
    const footNatX = (b0.minX + b0.maxX) * 0.5
    const footNatY = b0.maxY
    return { frames, footNatX, footNatY, refOpaqueHMax, bounds }
  } catch {
    return null
  }
}

/** Current texture index (0…4) for `simTime` — for future sync with pitch release. */
export function getPitcherFrameIndexAtTime(simTime: number): number {
  const t = simTime % PITCHER_LOOP_DURATION_SEC
  let step = Math.floor(t / STEP_SEC)
  if (step >= PITCHER_FRAME_SEQUENCE.length) {
    step = PITCHER_FRAME_SEQUENCE.length - 1
  }
  return PITCHER_FRAME_SEQUENCE[step]!
}

/**
 * Seconds until `simTime` reaches the start of the mariano4 (release) step, or `0` if already
 * inside that step. Matches `getPitcherFrameIndexAtTime` / `PITCHER_FRAME_SEQUENCE`.
 */
export function timeToNextPitcherReleasePhase(simTime: number): number {
  const loop = PITCHER_LOOP_DURATION_SEC
  const stepSec = loop / PITCHER_FRAME_SEQUENCE.length
  const t0 = PITCHER_RELEASE_STEP_INDEX * stepSec
  const t1 = t0 + stepSec
  const eps = 1e-4
  let tMod = simTime % loop
  if (tMod < 0) tMod += loop
  if (tMod >= t0 - eps && tMod < t1 - eps) return 0
  if (tMod < t0) return t0 - tMod
  return loop - tMod + t0
}

/**
 * Screen-space ball spawn at top-center of opaque silhouette for mariano4, using the same
 * transform as `drawPitcher` for that frame. Returns `null` if `pack` is unusable.
 */
export function getPitcherReleaseSpawnScreen(
  w: number,
  h: number,
  pack: PitcherPack | null
): { x: number; y: number } | null {
  if (!pack || pack.frames.length <= PITCHER_RELEASE_TEXTURE_INDEX) return null
  const img = pack.frames[PITCHER_RELEASE_TEXTURE_INDEX]!
  const b = pack.bounds[PITCHER_RELEASE_TEXTURE_INDEX]
  if (!b) return null
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  if (nw < 1 || nh < 1) return null
  const scale = (h * PITCHER_HEIGHT_FR) / pack.refOpaqueHMax
  const ax = w * PITCHER_ANCHOR_X_FR
  const ay = h * PITCHER_ANCHOR_Y_FR
  const dx = ax - pack.footNatX * scale + PITCHER_OFFSET_X_PX
  const dy = ay - pack.footNatY * scale + PITCHER_OFFSET_Y_PX
  const nx = (b.minX + b.maxX) * 0.5
  const ny = b.minY
  return { x: dx + nx * scale, y: dy + ny * scale }
}

let warnedMissingPitcherAssets = false

/** Shadow ellipse center offset from cleat anchor (+X right), screen px. */
const PITCHER_SHADOW_OFFSET_X_PX = -4
/** Nudge shadow vertically vs cleat (+Y down, −Y up), screen px. */
const PITCHER_SHADOW_OFFSET_Y_PX = -1

/**
 * mariano1 (texture index 0): extend shadow footprint 30% of half-width leftward only
 * (right edge unchanged). Achieved with rx×1.15 and center shifted −0.15×rx.
 */
const MARIANO1_SHADOW_LEFT_WIDEN_FR = 0.3

/**
 * Shadow width vs the old single ellipse: mariano1 (index 0) = 1/8, mariano4 (full extension) = 1/4.
 * Frames in between ramp linearly; mariano5 tapers back toward the narrow end.
 */
function pitcherGroundShadowWidthMul(frameIndex: number): number {
  const mariano1 = 1 / 8
  const fullExt = 1 / 4
  if (frameIndex <= 3) {
    return mariano1 + ((fullExt - mariano1) * frameIndex) / 3
  }
  return fullExt + (mariano1 - fullExt) * 0.55
}

/** Soft ellipse under the cleat anchor — drawn before the figure so it reads as ground contact. */
function drawPitcherGroundShadow(
  ctx: CanvasRenderingContext2D,
  footX: number,
  footY: number,
  radiusX: number,
  radiusY: number,
  widthMul: number,
  frameIndex: number
): void {
  let sx = footX + PITCHER_SHADOW_OFFSET_X_PX
  let rx = Math.max(6, radiusX * widthMul)
  const ry = Math.max(3.5, radiusY * Math.sqrt(widthMul))
  if (frameIndex === 0) {
    const rx0 = rx
    rx = rx0 * (1 + 0.5 * MARIANO1_SHADOW_LEFT_WIDEN_FR)
    sx -= 0.5 * MARIANO1_SHADOW_LEFT_WIDEN_FR * rx0
    /* +4px wider to the left only (right edge fixed): two × (center −1, +rx 1). */
    sx -= 2
    rx += 2
    /* +2px more on the left only (right edge still fixed). */
    sx -= 1
    rx += 1
    /* Translate whole shadow 2px left (both edges). */
    sx -= 2
  }
  if (frameIndex === 4) {
    /* +25px on the right only: +12.5 center, +12.5 half-axis (+5 vs prior +20). */
    sx += 12.5
    rx += 12.5
  }
  const sy = footY + PITCHER_SHADOW_OFFSET_Y_PX
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(sx, sy + 4, rx * 1.12, ry * 1.35, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(10, 18, 32, 0.12)'
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(sx, sy + 2, rx, ry, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(8, 16, 30, 0.22)'
  ctx.fill()
  ctx.restore()
}

/**
 * Silhouette mound pitcher when `mariano*.webp` are missing — same anchor + loop timing
 * so gameplay stays readable until real art is added (`npm run assets:webp-pitcher`).
 */
function drawSyntheticPitcher(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  simTime: number
): void {
  const fi = getPitcherFrameIndexAtTime(simTime)
  const ax = w * PITCHER_ANCHOR_X_FR
  const ay = h * PITCHER_ANCHOR_Y_FR
  const uh = h * PITCHER_HEIGHT_FR
  const bodyW = uh * 0.26
  const bodyH = uh * 0.52
  const headR = uh * 0.1
  const armPhase = fi / 4
  const armAngle = -1.15 + armPhase * 0.95

  const footX = ax + PITCHER_OFFSET_X_PX
  const footY = ay + PITCHER_OFFSET_Y_PX
  drawPitcherGroundShadow(
    ctx,
    footX,
    footY,
    Math.max(22, uh * 0.48),
    Math.max(4, uh * 0.05),
    pitcherGroundShadowWidthMul(fi),
    fi
  )

  ctx.save()
  ctx.translate(footX, footY)

  ctx.fillStyle = 'rgba(16, 36, 58, 0.92)'
  ctx.strokeStyle = 'rgba(210, 225, 240, 0.42)'
  ctx.lineWidth = Math.max(1.25, uh * 0.018)

  ctx.beginPath()
  ctx.roundRect(-bodyW * 0.5, -bodyH, bodyW, bodyH, bodyW * 0.32)
  ctx.fill()
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(0, -bodyH - headR * 0.85, headR, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  ctx.strokeStyle = 'rgba(230, 238, 248, 0.55)'
  ctx.lineWidth = Math.max(2, uh * 0.026)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(bodyW * 0.12, -bodyH * 0.72)
  const armLen = uh * 0.34
  ctx.lineTo(
    bodyW * 0.12 + Math.cos(armAngle) * armLen,
    -bodyH * 0.72 + Math.sin(armAngle) * armLen
  )
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(-bodyW * 0.18, -bodyH * 0.55)
  ctx.lineTo(-bodyW * 0.42, -bodyH * 0.2)
  ctx.stroke()

  ctx.restore()
}

/**
 * @param mode `hidden` skips draw; `idleLoop` / `release` advance the shared timeline.
 * If `pack` is null (no WebP assets yet), draws a synthetic mound figure so the role is visible.
 */
export function drawPitcher(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  simTime: number,
  pack: PitcherPack | null,
  mode: PitcherAnimMode
): void {
  if (mode === 'hidden') return

  if (
    pack == null ||
    pack.frames.length < 5 ||
    pack.bounds.length < pack.frames.length
  ) {
    if (!warnedMissingPitcherAssets) {
      warnedMissingPitcherAssets = true
      console.info(
        '[pitcher] Could not load all 5 WebP frames from /assets/pitcher/ — drawing placeholder. Expected names like mariano1.webp … mariano5.webp next to index (see pitcherAnimation.ts for alternates).'
      )
    }
    drawSyntheticPitcher(ctx, w, h, simTime)
    return
  }

  const fi = getPitcherFrameIndexAtTime(simTime)
  const img = pack.frames[fi]!
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  if (nw < 1 || nh < 1) {
    drawSyntheticPitcher(ctx, w, h, simTime)
    return
  }

  const scale = (h * PITCHER_HEIGHT_FR) / pack.refOpaqueHMax
  const dw = nw * scale
  const dh = nh * scale
  const ax = w * PITCHER_ANCHOR_X_FR
  const ay = h * PITCHER_ANCHOR_Y_FR
  const dx = ax - pack.footNatX * scale + PITCHER_OFFSET_X_PX
  const dy = ay - pack.footNatY * scale + PITCHER_OFFSET_Y_PX

  const footX = ax + PITCHER_OFFSET_X_PX
  const footY = ay + PITCHER_OFFSET_Y_PX
  const swMul = pitcherGroundShadowWidthMul(fi)
  drawPitcherGroundShadow(
    ctx,
    footX,
    footY,
    Math.max(28, dw * 0.34),
    Math.max(5, h * 0.0115),
    swMul,
    fi
  )

  ctx.drawImage(img, 0, 0, nw, nh, dx, dy, dw, dh)
}
