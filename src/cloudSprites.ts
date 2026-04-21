/**
 * WebP cloud bonus sprites (`public/assets/clouds/cloud1.webp` … `cloud6.webp`).
 * Draw + hit use opaque bounds only; transparent padding is ignored.
 */

import { measureOpaqueBounds, type OpaqueBounds } from './spriteOpaqueBounds'
import { TARGET_GOLD_GLOW_SHADOW } from './targetSpriteGlow'

export const CLOUD_VARIANT_COUNT = 6

export type CloudSpriteVariant = {
  img: HTMLImageElement
  bounds: OpaqueBounds
}

export type CloudTargetPack = {
  variants: readonly CloudSpriteVariant[]
  /** Parachute payload art (`hotdog.webp`); null if load failed. */
  hotdog: CloudSpriteVariant | null
}

/** Max opaque silhouette height vs logical canvas height (uniform scale). */
export const CLOUD_SPRITE_HEIGHT_FR = 0.095 * 1.2

/** Parachute + hot dog composite sprite height vs canvas (before visual mul). */
export const HOTDOG_SPRITE_HEIGHT_FR = 0.036

/** Draw / hit scale vs base `HOTDOG_SPRITE_HEIGHT_FR` (includes prior 3× + 30% size bump). */
export const HOTDOG_SPRITE_VISUAL_SCALE_MUL = 3 * 1.3

/** Extra scale on phones so clouds stay readable (draw + hit test). */
export const CLOUD_SPRITE_MOBILE_SCALE_MUL = 3

function modestGoldOuterGlowBlurPx(
  layoutScale: number,
  screenScaleMul: number,
  scaleMul = 1
): number {
  const m = Math.max(0.85, screenScaleMul * 0.48)
  const pop = 0.88 + 0.12 * Math.min(1.65, scaleMul)
  return Math.min(24, Math.max(7, 9.2 * layoutScale * m * pop))
}

function drawImageRectWithModestGoldGlow(
  ctx: CanvasRenderingContext2D,
  im: HTMLImageElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  layoutScale: number,
  screenScaleMul: number,
  scaleMul: number
): void {
  ctx.save()
  ctx.shadowColor = TARGET_GOLD_GLOW_SHADOW
  ctx.shadowBlur = modestGoldOuterGlowBlurPx(layoutScale, screenScaleMul, scaleMul)
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
  ctx.drawImage(im, sx, sy, sw, sh, dx, dy, dw, dh)
  ctx.restore()
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

export async function loadCloudTargetPack(): Promise<CloudTargetPack | null> {
  try {
    const imgs = await Promise.all(
      Array.from({ length: CLOUD_VARIANT_COUNT }, (_, i) => {
        const n = i + 1
        return loadImageDecoded([
          `/assets/clouds/cloud${n}.webp`,
          `/assets/clouds/cloud${n}.WEBP`,
        ])
      })
    )
    const variants = imgs.map((img) => ({
      img,
      bounds: measureOpaqueBounds(img),
    }))
    let hotdog: CloudSpriteVariant | null = null
    try {
      const him = await loadImageDecoded([
        `/assets/clouds/hotdog.webp`,
        `/assets/clouds/hotdog.WEBP`,
      ])
      hotdog = { img: him, bounds: measureOpaqueBounds(him) }
    } catch {
      /* no parachute-drop art */
    }
    return { variants, hotdog }
  } catch {
    return null
  }
}

export function cloudSpriteUniformScale(
  canvasH: number,
  b: OpaqueBounds,
  screenScaleMul = 1
): number {
  const oh = Math.max(1, b.maxY - b.minY)
  return (canvasH * CLOUD_SPRITE_HEIGHT_FR * screenScaleMul) / oh
}

export function hotdogSpriteUniformScale(
  canvasH: number,
  b: OpaqueBounds,
  screenScaleMul = 1
): number {
  const oh = Math.max(1, b.maxY - b.minY)
  return (
    (canvasH *
      HOTDOG_SPRITE_HEIGHT_FR *
      HOTDOG_SPRITE_VISUAL_SCALE_MUL *
      screenScaleMul) /
    oh
  )
}

/** Hit disc for the composite parachute payload (opaque footprint, clamped). */
export function hotdogSpriteHitRadiusPx(
  canvasH: number,
  b: OpaqueBounds,
  layoutScale: number,
  screenScaleMul = 1
): number {
  const sc = hotdogSpriteUniformScale(canvasH, b, screenScaleMul) * layoutScale
  const ow = (b.maxX - b.minX) * sc
  const oh = (b.maxY - b.minY) * sc
  const r = 0.5 * Math.max(ow, oh) * 0.44
  const cap = 110 * layoutScale * Math.max(1, screenScaleMul)
  return Math.max(16 * layoutScale * Math.max(1, screenScaleMul * 0.5), Math.min(cap, r))
}

/** Full `hotdog.webp` (chute + food): opaque bbox centered at world `(cx, cy)`. */
export function drawParachutePayloadSprite(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  v: CloudSpriteVariant,
  canvasH: number,
  layoutScale: number,
  screenScaleMul = 1
): void {
  const im = v.img
  const b = v.bounds
  const nw = im.naturalWidth
  const nh = im.naturalHeight
  if (nw < 1 || nh < 1) return
  const base = hotdogSpriteUniformScale(canvasH, b, screenScaleMul) * layoutScale
  const ocCx = (b.minX + b.maxX) * 0.5
  const ocCy = (b.minY + b.maxY) * 0.5
  const dw = nw * base
  const dh = nh * base
  const dx = centerX - ocCx * base
  const dy = centerY - ocCy * base
  drawImageRectWithModestGoldGlow(
    ctx,
    im,
    0,
    0,
    nw,
    nh,
    dx,
    dy,
    dw,
    dh,
    layoutScale,
    screenScaleMul,
    1
  )
}

/** Hit radius when using {@link drawParachutePayloadPlaceholder} (logical px scale). */
export function parachutePlaceholderHitRadiusPx(
  layoutScale: number,
  screenScaleMul = 1
): number {
  const m = Math.max(1, screenScaleMul)
  return Math.max(14, 38 * layoutScale * m)
}

/**
 * Vector stand-in when `hotdog.webp` is missing — canopy + mustard dog; matches gameplay hit disc.
 */
export function drawParachutePayloadPlaceholder(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  layoutScale: number,
  screenScaleMul = 1
): void {
  const m = Math.max(1, screenScaleMul)
  const sc = Math.max(0.35, layoutScale)
  const W = 52 * sc * m
  const H = 72 * sc * m

  ctx.save()
  ctx.translate(centerX, centerY)

  ctx.strokeStyle = 'rgba(235, 205, 135, 0.9)'
  ctx.fillStyle = 'rgba(255, 248, 225, 0.78)'
  ctx.lineWidth = Math.max(1.25, 2 * sc)
  ctx.beginPath()
  ctx.moveTo(-W * 0.55, -H * 0.15)
  ctx.quadraticCurveTo(0, -H * 0.52, W * 0.55, -H * 0.15)
  ctx.quadraticCurveTo(0, H * 0.08, -W * 0.55, -H * 0.15)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  ctx.strokeStyle = 'rgba(165, 155, 138, 0.8)'
  ctx.lineWidth = Math.max(1, 1.35 * sc)
  ctx.beginPath()
  ctx.moveTo(-W * 0.32, -H * 0.12)
  ctx.lineTo(-W * 0.18, H * 0.22)
  ctx.moveTo(W * 0.32, -H * 0.12)
  ctx.lineTo(W * 0.18, H * 0.22)
  ctx.stroke()

  ctx.fillStyle = 'rgba(205, 115, 58, 0.96)'
  ctx.strokeStyle = 'rgba(115, 52, 28, 0.72)'
  ctx.lineWidth = Math.max(1, 1.5 * sc)
  ctx.beginPath()
  ctx.roundRect(-W * 0.42, H * 0.18, W * 0.84, H * 0.14, H * 0.065)
  ctx.fill()
  ctx.stroke()

  ctx.strokeStyle = 'rgba(255, 215, 72, 0.92)'
  ctx.lineWidth = Math.max(1.5, 2.2 * sc)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(-W * 0.26, H * 0.26)
  ctx.quadraticCurveTo(0, H * 0.36, W * 0.26, H * 0.24)
  ctx.stroke()

  ctx.restore()
}

/** Hit disc in logical px — sized from opaque footprint, clamped for feel. */
export function cloudSpriteHitRadiusPx(
  canvasH: number,
  b: OpaqueBounds,
  layoutScale: number,
  screenScaleMul = 1
): number {
  const sc = cloudSpriteUniformScale(canvasH, b, screenScaleMul) * layoutScale
  const ow = (b.maxX - b.minX) * sc
  const oh = (b.maxY - b.minY) * sc
  const r = 0.5 * Math.max(ow, oh) * 0.44
  const cap = 42 * layoutScale * Math.max(1, screenScaleMul)
  return Math.max(10 * layoutScale * Math.max(1, screenScaleMul * 0.5), Math.min(cap, r))
}

function drawSpriteAtCenter(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  v: CloudSpriteVariant,
  canvasH: number,
  layoutScale: number,
  screenScaleMul: number,
  scaleMul: number,
  globalAlpha: number
): void {
  const im = v.img
  const b = v.bounds
  const nw = im.naturalWidth
  const nh = im.naturalHeight
  if (nw < 1 || nh < 1) return
  const base =
    cloudSpriteUniformScale(canvasH, b, screenScaleMul) * layoutScale * scaleMul
  const ocCx = (b.minX + b.maxX) * 0.5
  const ocCy = (b.minY + b.maxY) * 0.5
  const dw = nw * base
  const dh = nh * base
  const dx = centerX - ocCx * base
  const dy = centerY - ocCy * base
  const prev = ctx.globalAlpha
  ctx.globalAlpha = prev * globalAlpha
  drawImageRectWithModestGoldGlow(
    ctx,
    im,
    0,
    0,
    nw,
    nh,
    dx,
    dy,
    dw,
    dh,
    layoutScale,
    screenScaleMul,
    scaleMul
  )
  ctx.globalAlpha = prev
}

export function drawCloudSpriteDrifting(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  v: CloudSpriteVariant,
  canvasH: number,
  layoutScale: number,
  screenScaleMul = 1
): void {
  drawSpriteAtCenter(ctx, centerX, centerY, v, canvasH, layoutScale, screenScaleMul, 1, 1)
}

/** Pop progress u ∈ [0,1] (0 = just hit, 1 = gone). */
export function drawCloudSpritePopping(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  v: CloudSpriteVariant,
  canvasH: number,
  layoutScale: number,
  u: number,
  screenScaleMul = 1
): void {
  const alpha = Math.max(0, 1 - u)
  const scaleMul = 1 + u * 0.55
  drawSpriteAtCenter(
    ctx,
    centerX,
    centerY,
    v,
    canvasH,
    layoutScale,
    screenScaleMul,
    scaleMul,
    alpha * 0.96
  )
  ctx.save()
  ctx.translate(centerX, centerY)
  ctx.strokeStyle = `rgba(255, 245, 220, ${0.35 + u * 0.45})`
  ctx.lineWidth = (2 + u * 9) * Math.max(1, screenScaleMul * 0.65)
  ctx.beginPath()
  ctx.arc(0, 0, (18 + u * 52) * layoutScale * Math.max(1, screenScaleMul * 0.65), 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}
