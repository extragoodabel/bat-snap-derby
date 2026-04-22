/**
 * Environmental Mariners Hydro Challenge: boats cross the field1 seating band left → right,
 * independent of the carnival wheel rim system.
 */

import type { Vec2 } from './physics'
import {
  HYDRO_PLANE_TEX_ANCHOR_X_FR,
  HYDRO_PLANE_TEX_ANCHOR_Y_FR,
  HYDRO_PLANE_TEX_RADIUS_FR_OF_NAT_W,
  HYDRO_RACE_BAND_Y_MAX_FR,
  HYDRO_RACE_BAND_Y_MIN_FR,
} from './sceneLayout'
import type { HydroRingImages } from './hydroRingTargets'
import {
  discTargetImageShadowBlurPx,
  drawMiddleRingSignGoldenHalo,
  TARGET_GOLD_GLOW_SHADOW,
} from './targetSpriteGlow'

const MAX_ON_SCREEN = 4
/** Keep at least one racer “in frame” when the system can spawn. */
const MIN_ON_SCREEN = 1

const OFFSCREEN_LEFT = 320
const OFFSCREEN_RIGHT = 340

/** Wave rhythm: longer quiet gaps between packs, shorter gaps inside a burst. */
const SPAWN_GAP_MIN = 0.72
const SPAWN_GAP_MAX = 3.35
const WAVE_SKIP_P = 0.62
const BURST_FOLLOW_P = 0.44
const BURST_EXTRA_MIN = 1
const BURST_EXTRA_MAX = 3

const VX_MIN = 158
const VX_MAX = 328
const ACCEL_SMOOTH_RATE = 2.85

export type HydroRaceInstance = {
  id: number
  /** 0–3 → silver, green, red, yellow */
  variantIndex: number
  x: number
  baseY: number
  vx: number
  accelSmooth: number
  accelPhase: number
  lateralAmp: number
  lateralFreq: number
  lateralPhase: number
  yAmp1: number
  yFreq1: number
  yPhase1: number
  yAmp2: number
  yFreq2: number
  yPhase2: number
  rollPhase: number
  wasTriggered: boolean
}

export type HydroRaceSim = {
  instances: HydroRaceInstance[]
  /** Seconds until a spawn is attempted (wave rhythm). */
  spawnCooldown: number
  /** Extra spawns queued for tight packs. */
  burstRemain: number
  nextId: number
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
    yMin: h * HYDRO_RACE_BAND_Y_MIN_FR,
    yMax: h * HYDRO_RACE_BAND_Y_MAX_FR,
  }
}

export function initHydroRaceState(_w: number, h: number): HydroRaceSim {
  const { yMin, yMax } = bandFromCanvas(h)
  return {
    instances: [],
    spawnCooldown: 0.28,
    burstRemain: 0,
    nextId: 1,
    bandYMin: yMin,
    bandYMax: yMax,
  }
}

export function layoutHydroRaceBand(sim: {
  w: number
  h: number
  hydroRace: HydroRaceSim
}): void {
  const { yMin, yMax } = bandFromCanvas(sim.h)
  sim.hydroRace.bandYMin = yMin
  sim.hydroRace.bandYMax = yMax
}

function usedVariants(instances: HydroRaceInstance[]): Set<number> {
  const s = new Set<number>()
  for (const h of instances) s.add(h.variantIndex)
  return s
}

function pickVariant(instances: HydroRaceInstance[]): number | null {
  const used = usedVariants(instances)
  const avail: number[] = []
  for (let i = 0; i < 4; i++) if (!used.has(i)) avail.push(i)
  if (avail.length === 0) return null
  return avail[Math.floor(Math.random() * avail.length)]!
}

function spawnInstance(sim: HydroRaceSim): HydroRaceInstance | null {
  const v = pickVariant(sim.instances)
  if (v == null) return null

  const y0 = randRange(sim.bandYMin, sim.bandYMax)
  const baseVx = randRange(VX_MIN, VX_MAX)
  /** Slight stagger so packs don’t look like a perfect line at spawn. */
  const xJitter = randRange(-28, 12)
  return {
    id: sim.nextId++,
    variantIndex: v,
    x: -OFFSCREEN_LEFT + xJitter,
    baseY: y0,
    vx: baseVx,
    accelSmooth: 0,
    accelPhase: Math.random() * Math.PI * 2,
    lateralAmp: randRange(10, 38),
    lateralFreq: randRange(0.55, 1.35),
    lateralPhase: Math.random() * Math.PI * 2,
    yAmp1: randRange(5, 16),
    yFreq1: randRange(1.05, 2.15),
    yPhase1: Math.random() * Math.PI * 2,
    yAmp2: randRange(2.5, 8),
    yFreq2: randRange(2.4, 4.2),
    yPhase2: Math.random() * Math.PI * 2,
    rollPhase: Math.random() * Math.PI * 2,
    wasTriggered: false,
  }
}

function screenPos(
  h: HydroRaceInstance,
  simTime: number,
  yClamp: { lo: number; hi: number }
): Vec2 {
  const lat =
    h.lateralAmp * Math.sin(h.lateralFreq * simTime + h.lateralPhase)
  let y =
    h.baseY +
    h.yAmp1 * Math.sin(h.yFreq1 * simTime + h.yPhase1) +
    h.yAmp2 * Math.sin(h.yFreq2 * simTime + h.yPhase2)
  y = clamp(y, yClamp.lo, yClamp.hi)
  return { x: h.x + lat, y }
}

export function hydroRaceScreenPosition(
  h: HydroRaceInstance,
  simTime: number,
  band?: { yMin: number; yMax: number }
): Vec2 {
  const bc = band ?? { yMin: 0, yMax: 1e9 }
  return screenPos(h, simTime, { lo: bc.yMin, hi: bc.yMax })
}

function stepInstance(h: HydroRaceInstance, simTime: number, dt: number): void {
  const targetAccel =
    46 * Math.sin(simTime * 0.41 + h.accelPhase) +
    28 * Math.sin(simTime * 0.17 + h.accelPhase * 0.6)
  h.accelSmooth += (targetAccel - h.accelSmooth) * ACCEL_SMOOTH_RATE * dt
  h.vx += h.accelSmooth * dt
  h.vx = clamp(h.vx, VX_MIN * 0.72, VX_MAX * 1.18)
  h.x += h.vx * dt
}

export function updateHydroRace(
  sim: { w: number; hydroRace: HydroRaceSim; simTime: number },
  dt: number
): void {
  const hr = sim.hydroRace
  const t = sim.simTime

  for (const h of hr.instances) {
    stepInstance(h, t, dt)
  }

  hr.instances = hr.instances.filter(
    (h) => h.x < sim.w + OFFSCREEN_RIGHT
  )

  hr.spawnCooldown -= dt
  if (hr.instances.length < MIN_ON_SCREEN) {
    hr.spawnCooldown = Math.min(hr.spawnCooldown, 0.09)
  }
  if (hr.spawnCooldown > 0) return

  const onScreen = hr.instances.length
  const needMin = onScreen < MIN_ON_SCREEN

  if (onScreen >= MAX_ON_SCREEN) {
    hr.spawnCooldown = randRange(0.12, 0.35)
    return
  }

  if (
    !needMin &&
    hr.burstRemain <= 0 &&
    Math.random() < WAVE_SKIP_P
  ) {
    hr.spawnCooldown = randRange(SPAWN_GAP_MIN, SPAWN_GAP_MAX)
    return
  }

  const spawned = spawnInstance(hr)
  if (spawned) {
    hr.instances.push(spawned)
    if (hr.burstRemain > 0) {
      hr.burstRemain -= 1
      hr.spawnCooldown = randRange(0.08, 0.38)
    } else {
      if (Math.random() < BURST_FOLLOW_P) {
        hr.burstRemain = Math.floor(
          randRange(BURST_EXTRA_MIN, BURST_EXTRA_MAX + 1)
        )
        hr.spawnCooldown = randRange(0.06, 0.22)
      } else {
        hr.spawnCooldown = randRange(SPAWN_GAP_MIN, SPAWN_GAP_MAX)
      }
    }
  } else {
    hr.spawnCooldown = 0.12
  }
}

const VARIANT_ORDER: (keyof HydroRingImages)[] = [
  'silver',
  'green',
  'red',
  'yellow',
]

export function drawHydroRaceInstances(
  ctx: CanvasRenderingContext2D,
  instances: HydroRaceInstance[],
  imgs: HydroRingImages | null,
  targetR: number,
  simTime: number,
  band: { yMin: number; yMax: number }
): void {
  if (!imgs) return

  const yc = { lo: band.yMin, hi: band.yMax }
  const order = instances
    .map((h, i) => ({ i, y: screenPos(h, simTime, yc).y }))
    .sort((a, b) => a.y - b.y)

  for (const { i } of order) {
    const h = instances[i]!
    const pt = screenPos(h, simTime, yc)
    drawHydroPlaneEnvironmental(
      ctx,
      pt,
      targetR,
      h.variantIndex,
      imgs,
      h.wasTriggered ? 0.38 : 1,
      simTime,
      h.rollPhase
    )
  }
}

function drawHydroPlaneEnvironmental(
  ctx: CanvasRenderingContext2D,
  pt: Vec2,
  targetR: number,
  variantIndex: number,
  imgs: HydroRingImages | null,
  alphaMul: number,
  simTime: number,
  rollPhase: number
): boolean {
  if (!imgs) return false
  const key = VARIANT_ORDER[((variantIndex % 4) + 4) % 4]
  const im = imgs[key]
  if (!im?.complete || im.naturalWidth < 1) return false

  const iw = im.naturalWidth
  const ih = im.naturalHeight
  const k = HYDRO_PLANE_TEX_RADIUS_FR_OF_NAT_W
  const dw = targetR / k
  const dh = ih * (dw / iw)
  const ax = pt.x - HYDRO_PLANE_TEX_ANCHOR_X_FR * dw
  const ay = pt.y - HYDRO_PLANE_TEX_ANCHOR_Y_FR * dh

  const signR = targetR
  drawMiddleRingSignGoldenHalo(ctx, pt.x, pt.y, signR, alphaMul)

  ctx.save()
  ctx.globalAlpha *= alphaMul
  ctx.translate(pt.x, pt.y)
  ctx.rotate(0.11 * Math.sin(simTime * 1.02 + rollPhase))
  ctx.translate(-pt.x, -pt.y)
  ctx.imageSmoothingEnabled = true
  ctx.shadowColor = TARGET_GOLD_GLOW_SHADOW
  ctx.shadowBlur = discTargetImageShadowBlurPx(signR)
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
  ctx.drawImage(im, 0, 0, iw, ih, ax, ay, dw, dh)
  ctx.restore()
  return true
}
