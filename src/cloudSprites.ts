/**
 * WebP cloud bonus sprites (`public/assets/clouds/cloud1.webp` … `cloud6.webp`).
 * Draw + hit use opaque bounds only; transparent padding is ignored.
 */

import { measureOpaqueBounds, type OpaqueBounds } from './spriteOpaqueBounds'

export const CLOUD_VARIANT_COUNT = 6

export type CloudSpriteVariant = {
  img: HTMLImageElement
  bounds: OpaqueBounds
}

export type CloudTargetPack = {
  variants: readonly CloudSpriteVariant[]
}

/** Max opaque silhouette height vs logical canvas height (uniform scale). */
export const CLOUD_SPRITE_HEIGHT_FR = 0.095

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
    return { variants }
  } catch {
    return null
  }
}

export function cloudSpriteUniformScale(canvasH: number, b: OpaqueBounds): number {
  const oh = Math.max(1, b.maxY - b.minY)
  return (canvasH * CLOUD_SPRITE_HEIGHT_FR) / oh
}

/** Hit disc in logical px — sized from opaque footprint, clamped for feel. */
export function cloudSpriteHitRadiusPx(
  canvasH: number,
  b: OpaqueBounds,
  layoutScale: number
): number {
  const sc = cloudSpriteUniformScale(canvasH, b) * layoutScale
  const ow = (b.maxX - b.minX) * sc
  const oh = (b.maxY - b.minY) * sc
  const r = 0.5 * Math.max(ow, oh) * 0.44
  return Math.max(10 * layoutScale, Math.min(42 * layoutScale, r))
}

function drawSpriteAtCenter(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  v: CloudSpriteVariant,
  canvasH: number,
  layoutScale: number,
  scaleMul: number,
  globalAlpha: number
): void {
  const im = v.img
  const b = v.bounds
  const nw = im.naturalWidth
  const nh = im.naturalHeight
  if (nw < 1 || nh < 1) return
  const base = cloudSpriteUniformScale(canvasH, b) * layoutScale * scaleMul
  const ocCx = (b.minX + b.maxX) * 0.5
  const ocCy = (b.minY + b.maxY) * 0.5
  const dw = nw * base
  const dh = nh * base
  const dx = centerX - ocCx * base
  const dy = centerY - ocCy * base
  const prev = ctx.globalAlpha
  ctx.globalAlpha = prev * globalAlpha
  ctx.drawImage(im, 0, 0, nw, nh, dx, dy, dw, dh)
  ctx.globalAlpha = prev
}

export function drawCloudSpriteDrifting(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  v: CloudSpriteVariant,
  canvasH: number,
  layoutScale: number
): void {
  drawSpriteAtCenter(ctx, centerX, centerY, v, canvasH, layoutScale, 1, 1)
}

/** Pop progress u ∈ [0,1] (0 = just hit, 1 = gone). */
export function drawCloudSpritePopping(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  v: CloudSpriteVariant,
  canvasH: number,
  layoutScale: number,
  u: number
): void {
  const alpha = Math.max(0, 1 - u)
  const scaleMul = 1 + u * 0.55
  drawSpriteAtCenter(ctx, centerX, centerY, v, canvasH, layoutScale, scaleMul, alpha * 0.96)
  ctx.save()
  ctx.translate(centerX, centerY)
  ctx.strokeStyle = `rgba(255, 245, 220, ${0.35 + u * 0.45})`
  ctx.lineWidth = 2 + u * 9
  ctx.beginPath()
  ctx.arc(0, 0, (18 + u * 52) * layoutScale, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}
