/**
 * Floating cloud bonus targets (placeholder art when no WebP pack) +
 * parachute drops: every cloud hit releases a hotdog-from-heaven (`hotdog.webp` when loaded,
 * vector fallback otherwise).
 * Independent from spinning disc targets.
 */
import { circlesOverlap, type Ball } from './physics'
import { CLOUD_TARGET_POINTS } from './scoreboard'
import {
  CLOUD_VARIANT_COUNT,
  cloudSpriteHitRadiusPx,
  drawCloudSpriteDrifting,
  drawCloudSpritePopping,
  drawParachutePayloadPlaceholder,
  drawParachutePayloadSprite,
  hotdogSpriteHitRadiusPx,
  parachutePlaceholderHitRadiusPx,
  type CloudTargetPack,
} from './cloudSprites'

// --- Tunables (see design doc) ---------------------------------------------

/** Expected cloud spawns per second (reciprocal used as mean delay baseline). */
export const CLOUD_SPAWN_RATE = 0.78
/** Seconds ± jitter around mean spawn delay `1 / CLOUD_SPAWN_RATE`. */
export const CLOUD_SPAWN_JITTER_SEC = 0.88

export const CLOUD_SPEED_MIN = 32
export const CLOUD_SPEED_MAX = 54

/**
 * Vertical spawn band as **fraction of canvas height** (0 = top edge).
 * ~15–25% region from top of playfield.
 */
export const CLOUD_TOP_BAND_MIN_Y = 0.14
export const CLOUD_TOP_BAND_MAX_Y = 0.24

/** Logical px: moves clouds (+drops spawned from hits) upward on screen (−Y). */
export const CLOUD_LAYER_NUDGE_Y = -30

export const CLOUD_BOB_AMPLITUDE = 7
export const CLOUD_BOB_SPEED = 1.05

export const PARACHUTE_DESCENT_SPEED = 46
/** Peak horizontal speed (px/s) for the main back-and-forth sway (cosine-driven). */
export const PARACHUTE_SWAY_AMPLITUDE = 42
/** Angular speed (rad/s) for horizontal drift oscillation. */
export const PARACHUTE_SWAY_SPEED = 1.45
/** Second harmonic mix (0–1): adds irregular left-right weave. */
export const PARACHUTE_SWAY_SECONDARY = 0.32
/** Second harmonic frequency multiplier vs `PARACHUTE_SWAY_SPEED`. */
export const PARACHUTE_SWAY_SECONDARY_W_MUL = 1.33
/** Extra gentle vertical bob on payload (px scale, sin-driven). */
export const PARACHUTE_VERTICAL_WOBBLE_AMP = 2.2
export const PARACHUTE_VERTICAL_WOBBLE_SPEED = 2.4

const CLOUD_OFFSCREEN_MARGIN = 72
const MAX_CLOUDS = 11
const MAX_PARACHUTES = 14

/** Hit radius for the bullseye on the cloud (logical px). */
export const CLOUD_HIT_RADIUS = 24
const CLOUD_POP_DURATION = 0.2
const PARACHUTE_LIFETIME_SEC = 48

// ---------------------------------------------------------------------------

export type CloudTargetState = 'drifting' | 'popping'

export type CloudTarget = {
  id: number
  state: CloudTargetState
  x: number
  /** Vertical anchor in the top band (bob oscillates around this). */
  yAnchor: number
  vx: number
  /** Phase offset for bob (rad). */
  bobPhase: number
  popRemain: number
  /** Index into loaded `CloudTargetPack.variants` (0…5 for `cloud1`…`cloud6`). */
  variantIndex: number
}

export type ParachutePayload = {
  id: number
  x: number
  y: number
  swayPhase: number
  alive: boolean
  age: number
}

export type FloatingCloudSimFields = {
  w: number
  h: number
  simTime: number
  score: number
  /** Same `scale` as `SceneLayout` — scales hit radii / placeholder art with the board. */
  sceneLayout: { scale: number }
  /** Spacey / other bonuses: applied to {@link CLOUD_TARGET_POINTS} adds. */
  scorePointMultiplier: number
  cloudTargets: CloudTarget[]
  parachutePayloads: ParachutePayload[]
  cloudSpawnCountdown: number
  nextFloatingTargetId: number
}

function randRange(a: number, b: number): number {
  return a + Math.random() * (b - a)
}

function nextCloudSpawnDelay(): number {
  const mean = 1 / Math.max(0.05, CLOUD_SPAWN_RATE)
  return Math.max(0.35, mean + (Math.random() - 0.5) * 2 * CLOUD_SPAWN_JITTER_SEC)
}

export function cloudWorldY(simTime: number, c: CloudTarget): number {
  return (
    CLOUD_LAYER_NUDGE_Y +
    c.yAnchor +
    Math.sin(simTime * CLOUD_BOB_SPEED + c.bobPhase) * CLOUD_BOB_AMPLITUDE
  )
}

function spawnCloud(sim: FloatingCloudSimFields): void {
  if (sim.cloudTargets.length >= MAX_CLOUDS) return
  const w = sim.w
  const h = sim.h
  const fromLeft = Math.random() < 0.5
  const speed = randRange(CLOUD_SPEED_MIN, CLOUD_SPEED_MAX)
  const vx = fromLeft ? speed : -speed
  const x = fromLeft ? -CLOUD_OFFSCREEN_MARGIN : w + CLOUD_OFFSCREEN_MARGIN
  const yAnchor = randRange(h * CLOUD_TOP_BAND_MIN_Y, h * CLOUD_TOP_BAND_MAX_Y)
  const id = sim.nextFloatingTargetId++
  sim.cloudTargets.push({
    id,
    state: 'drifting',
    x,
    yAnchor,
    vx,
    bobPhase: Math.random() * Math.PI * 2,
    popRemain: 0,
    variantIndex: Math.floor(Math.random() * CLOUD_VARIANT_COUNT),
  })
}

export function initFloatingCloudLayer(sim: FloatingCloudSimFields): void {
  sim.cloudTargets = []
  sim.parachutePayloads = []
  sim.cloudSpawnCountdown = nextCloudSpawnDelay()
  sim.nextFloatingTargetId = 1
}

export function updateFloatingCloudLayer(
  sim: FloatingCloudSimFields,
  dt: number
): void {
  sim.cloudSpawnCountdown -= dt
  if (sim.cloudSpawnCountdown <= 0) {
    spawnCloud(sim)
    sim.cloudSpawnCountdown = nextCloudSpawnDelay()
  }

  for (let i = sim.cloudTargets.length - 1; i >= 0; i--) {
    const c = sim.cloudTargets[i]
    if (c.state === 'drifting') {
      c.x += c.vx * dt
      const margin = CLOUD_OFFSCREEN_MARGIN + 40
      const out =
        (c.vx > 0 && c.x > sim.w + margin) || (c.vx < 0 && c.x < -margin)
      if (out) {
        sim.cloudTargets.splice(i, 1)
      }
    } else {
      c.popRemain -= dt
      if (c.popRemain <= 0) {
        /* Hot dog already released on cloud hit in `applyFloatingTargetHitsForBall`. */
        sim.cloudTargets.splice(i, 1)
      }
    }
  }

  for (let j = sim.parachutePayloads.length - 1; j >= 0; j--) {
    const p = sim.parachutePayloads[j]
    if (!p.alive) {
      sim.parachutePayloads.splice(j, 1)
      continue
    }

    p.age += dt
    const t = sim.simTime
    const w = PARACHUTE_SWAY_SPEED
    const ph = p.swayPhase
    // Cosine = derivative of sine → smooth left-right drift (not a crawl in one direction).
    const primary = Math.cos(t * w + ph) * PARACHUTE_SWAY_AMPLITUDE
    const w2 = w * PARACHUTE_SWAY_SECONDARY_W_MUL
    const secondary =
      Math.cos(t * w2 + ph * 0.9) *
      PARACHUTE_SWAY_AMPLITUDE *
      PARACHUTE_SWAY_SECONDARY
    p.x += (primary + secondary) * dt
    const vyWobble =
      Math.sin(sim.simTime * PARACHUTE_VERTICAL_WOBBLE_SPEED + p.swayPhase * 0.7) *
      PARACHUTE_VERTICAL_WOBBLE_AMP
    p.y += (PARACHUTE_DESCENT_SPEED + vyWobble) * dt

    if (
      p.y > sim.h + 80 ||
      p.age > PARACHUTE_LIFETIME_SEC ||
      p.x < -120 ||
      p.x > sim.w + 120
    ) {
      sim.parachutePayloads.splice(j, 1)
    }
  }
}

/**
 * Ball vs floating clouds + parachute payloads. Ball velocity unchanged.
 * Clouds only in `drifting`; payloads use `alive`.
 */
export function applyFloatingTargetHitsForBall(
  sim: FloatingCloudSimFields,
  ball: Ball,
  ballR: number,
  cloudPack: CloudTargetPack | null,
  cloudScreenScaleMul = 1
): void {
  const br = Math.max(ballR, ball.r)
  const s = Math.max(0.25, sim.sceneLayout.scale)

  const hdHit = cloudPack?.hotdog ?? null
  const payloadHitR =
    hdHit != null
      ? hotdogSpriteHitRadiusPx(sim.h, hdHit.bounds, s, cloudScreenScaleMul)
      : parachutePlaceholderHitRadiusPx(s, cloudScreenScaleMul)

  for (let j = sim.parachutePayloads.length - 1; j >= 0; j--) {
    const p = sim.parachutePayloads[j]
    if (!p.alive) continue
    if (payloadHitR > 0 && circlesOverlap(ball.x, ball.y, br, p.x, p.y, payloadHitR)) {
      p.alive = false
      const mul = Math.max(1, sim.scorePointMultiplier)
      sim.score += Math.round(CLOUD_TARGET_POINTS * mul)
    }
  }

  for (const c of sim.cloudTargets) {
    if (c.state !== 'drifting') continue
    const cy = cloudWorldY(sim.simTime, c)
    const vn =
      cloudPack != null && cloudPack.variants.length > 0
        ? cloudPack.variants[c.variantIndex % cloudPack.variants.length]!
        : null
    const hitR =
      vn != null
        ? cloudSpriteHitRadiusPx(sim.h, vn.bounds, s, cloudScreenScaleMul)
        : CLOUD_HIT_RADIUS * s * cloudScreenScaleMul
    if (circlesOverlap(ball.x, ball.y, br, c.x, cy, hitR)) {
      c.state = 'popping'
      c.popRemain = CLOUD_POP_DURATION
      const mulC = Math.max(1, sim.scorePointMultiplier)
      sim.score += Math.round(CLOUD_TARGET_POINTS * mulC)
      if (sim.parachutePayloads.length < MAX_PARACHUTES) {
        sim.parachutePayloads.push({
          id: sim.nextFloatingTargetId++,
          x: c.x,
          y: cy + 40 * s,
          swayPhase: Math.random() * Math.PI * 2,
          alive: true,
          age: 0,
        })
      }
      break
    }
  }
}

export function drawFloatingCloudLayer(
  ctx: CanvasRenderingContext2D,
  sim: FloatingCloudSimFields,
  cloudPack: CloudTargetPack | null,
  cloudScreenScaleMul = 1
): void {
  const t = sim.simTime
  const s = Math.max(0.25, sim.sceneLayout.scale)

  for (const c of sim.cloudTargets) {
    const y = cloudWorldY(t, c)
    const vn =
      cloudPack != null && cloudPack.variants.length > 0
        ? cloudPack.variants[c.variantIndex % cloudPack.variants.length]!
        : null

    if (c.state === 'popping') {
      const u =
        1 - Math.max(0, Math.min(CLOUD_POP_DURATION, c.popRemain)) / CLOUD_POP_DURATION
      if (vn != null) {
        drawCloudSpritePopping(ctx, c.x, y, vn, sim.h, s, u, cloudScreenScaleMul)
      } else {
        ctx.save()
        ctx.translate(c.x, y)
        const a = 1 - u
        ctx.globalAlpha = Math.max(0, a * 0.95)
        ctx.strokeStyle = `rgba(255, 240, 220, ${0.45 + u * 0.4})`
        ctx.lineWidth = 3 + u * 10
        ctx.beginPath()
        ctx.arc(
          0,
          0,
          (CLOUD_HIT_RADIUS * s + u * 55 * s) * cloudScreenScaleMul,
          0,
          Math.PI * 2
        )
        ctx.stroke()
        ctx.globalAlpha = 1
        ctx.restore()
      }
      continue
    }

    if (vn != null) {
      drawCloudSpriteDrifting(ctx, c.x, y, vn, sim.h, s, cloudScreenScaleMul)
      continue
    }

    ctx.save()
    ctx.translate(c.x, y)
    const m = cloudScreenScaleMul
    // Placeholder cloud: soft ellipse cluster (no WebP pack)
    const blob = (
      ox: number,
      oy: number,
      rx: number,
      ry: number,
      fill: string
    ) => {
      ctx.beginPath()
      ctx.ellipse(ox, oy, rx, ry, 0, 0, Math.PI * 2)
      ctx.fillStyle = fill
      ctx.fill()
    }
    blob(-28 * s * m, 4 * s * m, 34 * s * m, 22 * s * m, 'rgba(230, 238, 248, 0.42)')
    blob(8 * s * m, 0, 40 * s * m, 26 * s * m, 'rgba(220, 232, 245, 0.5)')
    blob(36 * s * m, 6 * s * m, 30 * s * m, 20 * s * m, 'rgba(210, 226, 240, 0.38)')

    ctx.strokeStyle = 'rgba(212, 48, 48, 0.85)'
    ctx.lineWidth = Math.max(1.25, 2.5 * s * m)
    ctx.beginPath()
    ctx.arc(0, 0, CLOUD_HIT_RADIUS * s * 0.42 * m, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = 'rgba(255, 80, 72, 0.35)'
    ctx.beginPath()
    ctx.arc(0, 0, CLOUD_HIT_RADIUS * s * 0.28 * m, 0, Math.PI * 2)
    ctx.fill()

    ctx.restore()
  }

  const hd = cloudPack?.hotdog ?? null
  for (const p of sim.parachutePayloads) {
    if (!p.alive) continue
    if (hd != null) {
      drawParachutePayloadSprite(
        ctx,
        p.x,
        p.y,
        hd,
        sim.h,
        s,
        cloudScreenScaleMul
      )
    } else {
      drawParachutePayloadPlaceholder(ctx, p.x, p.y, s, cloudScreenScaleMul)
    }
  }
}
