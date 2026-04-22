/**
 * Environmental salmon run (51 pt): exactly one race group at a time — four unique sprites
 * (salmon1–4), right → left. No new group until all four have left the screen (including
 * Humpy last). Hits remove the fish immediately.
 */

import type { Vec2 } from './physics'
import {
  SALMON_TARGET_TEX_ANCHOR_X_FR,
  SALMON_TARGET_TEX_ANCHOR_Y_FR,
  SALMON_TARGET_TEX_RADIUS_FR_OF_NAT_W,
  SALMON_RUN_BAND_Y_MAX_FR,
  SALMON_RUN_BAND_Y_MIN_FR,
} from './sceneLayout'
import {
  type MiddleRingTargetImages,
  SALMON_TARGET_SCALE,
} from './middleRingTargets'
import {
  discTargetImageShadowBlurPx,
  drawMiddleRingSignGoldenHalo,
  TARGET_GOLD_GLOW_SHADOW,
} from './targetSpriteGlow'

const OFFSCREEN_RIGHT = 480
const OFFSCREEN_LEFT = 420

/** Base gap behind the lead pack; grows slightly as the race progresses. */
const HUMPY_GAP_BASE_PX = 26
const HUMPY_GAP_MAX_EXTRA = 22

const ACCEL_SMOOTH_RATE = 2.4
const Y_DRIFT_AMP_MAX = 2.8
const Y_DRIFT_FREQ = 0.45

/** Cooldown after a full group has cleared before the next race starts. */
const BETWEEN_GROUPS_MIN = 0.55
const BETWEEN_GROUPS_MAX = 1.45

export type SalmonRunFish = {
  id: number
  groupId: number
  groupSpawnSimT: number
  /** Which asset: 1–4 (4 = Humpy). */
  species: 1 | 2 | 3 | 4
  isHumpy: boolean
  x: number
  baseY: number
  vx: number
  accelPhase: number
  accelSmooth: number
  yPhase: number
  yDriftAmp: number
  /** Slight stagger so the four don’t move on the same frame. */
  moveStartSimT: number
}

export type SalmonRunSim = {
  fish: SalmonRunFish[]
  /** When the current/last spawned group started (for Humpy trailing ramp). */
  groupSpawnSimT: number
  spawnCooldown: number
  nextId: number
  nextGroupId: number
  bandYMin: number
  bandYMax: number
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}

function randRange(a: number, b: number): number {
  return a + Math.random() * (b - a)
}

function bandFromCanvas(h: number): { yMin: number; yMax: number } {
  return {
    yMin: h * SALMON_RUN_BAND_Y_MIN_FR,
    yMax: h * SALMON_RUN_BAND_Y_MAX_FR,
  }
}

export function initSalmonRunState(_w: number, h: number): SalmonRunSim {
  const { yMin, yMax } = bandFromCanvas(h)
  return {
    fish: [],
    groupSpawnSimT: 0,
    spawnCooldown: 0.35,
    nextId: 1,
    nextGroupId: 1,
    bandYMin: yMin,
    bandYMax: yMax,
  }
}

export function layoutSalmonRunBand(sim: {
  w: number
  h: number
  salmonRun: SalmonRunSim
}): void {
  const { yMin, yMax } = bandFromCanvas(sim.h)
  sim.salmonRun.bandYMin = yMin
  sim.salmonRun.bandYMax = yMax
}

function shuffleTriplet(): [1 | 2 | 3, 1 | 2 | 3, 1 | 2 | 3] {
  const a: (1 | 2 | 3)[] = [1, 2, 3]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return [a[0]!, a[1]!, a[2]!]
}

/**
 * One coordinated race: exactly one each of salmon1–4, shared pace, tight entry,
 * Humpy starts further right and must stay behind.
 */
function spawnSalmonRaceGroup(sim: SalmonRunSim, w: number, simTime: number): void {
  const gid = sim.nextGroupId++
  const triplet = shuffleTriplet()
  sim.groupSpawnSimT = simTime

  /** Shared group speed (px/s to the left = negative vx). */
  const packSpeed = randRange(215, 292)
  const leadRef = -packSpeed

  const baseY = randRange(sim.bandYMin + 6, sim.bandYMax - 6)
  const tBase = simTime
  /** Short stagger only (same “event”), Humpy last to start. */
  const d0 = randRange(0, 0.04)
  const d1 = d0 + randRange(0.06, 0.14)
  const d2 = d1 + randRange(0.06, 0.14)
  const d3 = d2 + randRange(0.1, 0.22)

  const col = w + OFFSCREEN_RIGHT + randRange(-25, 45)
  const packSpread = randRange(38, 72)
  const humpyExtra = randRange(85, 165)
  const x0 = col
  const x1 = col + packSpread * 1
  const x2 = col + packSpread * 2
  const x3 = col + packSpread * 2.3 + humpyExtra

  const speciesList: (1 | 2 | 3 | 4)[] = [triplet[0], triplet[1], triplet[2], 4]
  const xs = [x0, x1, x2, x3]
  const starts = [tBase + d0, tBase + d1, tBase + d2, tBase + d3]
  const yOff = [randRange(-3, 3), randRange(-3, 3), randRange(-3, 3), randRange(-4, 4)]

  for (let i = 0; i < 4; i++) {
    const species = speciesList[i]!
    const isHumpy = species === 4
    let vx0: number
    if (isHumpy) {
      const slow = randRange(0.52, 0.68)
      vx0 = leadRef * slow + randRange(-6, 10)
    } else {
      vx0 = leadRef + randRange(-18, 18)
    }
    sim.fish.push({
      id: sim.nextId++,
      groupId: gid,
      groupSpawnSimT: sim.groupSpawnSimT,
      species,
      isHumpy,
      x: xs[i]!,
      baseY: baseY + yOff[i]!,
      vx: vx0,
      accelPhase: Math.random() * Math.PI * 2,
      accelSmooth: 0,
      yPhase: Math.random() * Math.PI * 2,
      yDriftAmp: randRange(0.8, Y_DRIFT_AMP_MAX),
      moveStartSimT: starts[i]!,
    })
  }
}

function stepFish(f: SalmonRunFish, simTime: number, dt: number): void {
  if (simTime < f.moveStartSimT) return

  const targetAccel = f.isHumpy
    ? 18 * Math.sin(simTime * 0.28 + f.accelPhase)
    : 32 * Math.sin(simTime * 0.35 + f.accelPhase) +
      14 * Math.sin(simTime * 0.12 + f.accelPhase * 0.65)

  f.accelSmooth += (targetAccel - f.accelSmooth) * ACCEL_SMOOTH_RATE * dt
  f.vx += f.accelSmooth * dt

  const leadLo = -310
  const leadHi = -185
  if (f.isHumpy) {
    f.vx = clamp(f.vx, leadLo, -95)
  } else {
    f.vx = clamp(f.vx, leadLo, leadHi)
  }

  f.x += f.vx * dt
}

function humpyGapPx(simTime: number, groupSpawnSimT: number): number {
  const elapsed = Math.max(0, simTime - groupSpawnSimT)
  const ramp = Math.min(1, elapsed / 2.8)
  return HUMPY_GAP_BASE_PX + ramp * HUMPY_GAP_MAX_EXTRA
}

function enforceHumpyBehindPack(
  fish: SalmonRunFish[],
  simTime: number,
  groupSpawnSimT: number
): void {
  const byGroup = new Map<number, SalmonRunFish[]>()
  for (const f of fish) {
    const arr = byGroup.get(f.groupId)
    if (arr) arr.push(f)
    else byGroup.set(f.groupId, [f])
  }

  const gap = humpyGapPx(simTime, groupSpawnSimT)

  for (const g of byGroup.values()) {
    const humpy = g.find((x) => x.isHumpy)
    if (!humpy) continue
    const leads = g.filter((x) => !x.isHumpy)
    if (leads.length === 0) continue
    const maxLeadX = Math.max(...leads.map((o) => o.x))
    if (humpy.x < maxLeadX + gap) {
      humpy.x = maxLeadX + gap
    }
  }
}

export function salmonRunScreenPosition(
  f: SalmonRunFish,
  simTime: number,
  band: { yMin: number; yMax: number }
): Vec2 {
  const y =
    f.baseY + f.yDriftAmp * Math.sin(Y_DRIFT_FREQ * simTime + f.yPhase)
  const yy = clamp(y, band.yMin, band.yMax)
  return { x: f.x, y: yy }
}

export function updateSalmonRun(
  sim: { w: number; salmonRun: SalmonRunSim; simTime: number },
  dt: number
): void {
  const sr = sim.salmonRun
  const t = sim.simTime

  for (const f of sr.fish) {
    stepFish(f, t, dt)
  }

  if (sr.fish.length > 0) {
    enforceHumpyBehindPack(sr.fish, t, sr.groupSpawnSimT)
  }

  sr.fish = sr.fish.filter((f) => f.x > -OFFSCREEN_LEFT)

  if (sr.fish.length > 0) {
    return
  }

  sr.spawnCooldown -= dt
  if (sr.spawnCooldown > 0) return

  spawnSalmonRaceGroup(sr, sim.w, t)
  sr.spawnCooldown = randRange(BETWEEN_GROUPS_MIN, BETWEEN_GROUPS_MAX)
}

const SPECIES_TO_KEY: Record<
  1 | 2 | 3 | 4,
  keyof MiddleRingTargetImages
> = {
  1: 'salmon1',
  2: 'salmon2',
  3: 'salmon3',
  4: 'salmon4',
}

export function drawSalmonRunFish(
  ctx: CanvasRenderingContext2D,
  fish: SalmonRunFish[],
  imgs: MiddleRingTargetImages | null,
  targetR: number,
  simTime: number,
  band: { yMin: number; yMax: number }
): void {
  if (!imgs) return

  const order = fish
    .map((f, i) => ({ i, y: salmonRunScreenPosition(f, simTime, band).y }))
    .sort((a, b) => a.y - b.y)

  for (const { i } of order) {
    const f = fish[i]!
    const pt = salmonRunScreenPosition(f, simTime, band)
    drawSalmonRunSprite(ctx, pt, f, imgs, targetR)
  }
}

function drawSalmonRunSprite(
  ctx: CanvasRenderingContext2D,
  pt: Vec2,
  f: SalmonRunFish,
  imgs: MiddleRingTargetImages,
  targetR: number
): void {
  const key = SPECIES_TO_KEY[f.species]
  const im = imgs[key]
  if (!im?.complete || im.naturalWidth < 1) return

  const iw = im.naturalWidth
  const ih = im.naturalHeight
  const k = SALMON_TARGET_TEX_RADIUS_FR_OF_NAT_W
  const dw = (targetR / k) * SALMON_TARGET_SCALE
  const dh = ih * (dw / iw)
  const ax = pt.x - SALMON_TARGET_TEX_ANCHOR_X_FR * dw
  const ay = pt.y - SALMON_TARGET_TEX_ANCHOR_Y_FR * dh
  const signR = targetR * SALMON_TARGET_SCALE

  drawMiddleRingSignGoldenHalo(ctx, pt.x, pt.y, signR, 1)

  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.shadowColor = TARGET_GOLD_GLOW_SHADOW
  ctx.shadowBlur = discTargetImageShadowBlurPx(signR)
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
  ctx.drawImage(im, 0, 0, iw, ih, ax, ay, dw, dh)
  ctx.restore()
}
