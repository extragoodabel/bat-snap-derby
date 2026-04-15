/**
 * Bounding box of opaque pixels in an image (source pixel coords).
 * maxX / maxY are exclusive (slice-style).
 */
export type OpaqueBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const DEFAULT_ALPHA_THRESHOLD = 10

/**
 * Scan RGBA data for alpha > threshold. Falls back to full image if none found.
 */
export function measureOpaqueBounds(
  img: HTMLImageElement,
  alphaThreshold: number = DEFAULT_ALPHA_THRESHOLD
): OpaqueBounds {
  const w = img.naturalWidth
  const h = img.naturalHeight
  const full: OpaqueBounds = { minX: 0, minY: 0, maxX: w, maxY: h }
  if (w < 1 || h < 1) return full

  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return full

  ctx.drawImage(img, 0, 0)
  let data: ImageData
  try {
    data = ctx.getImageData(0, 0, w, h)
  } catch {
    return full
  }

  const pix = data.data
  let minX = w
  let minY = h
  let maxX = 0
  let maxY = 0
  let any = false

  for (let y = 0; y < h; y++) {
    const row = y * w * 4
    for (let x = 0; x < w; x++) {
      const a = pix[row + x * 4 + 3]
      if (a > alphaThreshold) {
        any = true
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x + 1 > maxX) maxX = x + 1
        if (y + 1 > maxY) maxY = y + 1
      }
    }
  }

  if (!any || maxX <= minX || maxY <= minY) return full
  return { minX, minY, maxX, maxY }
}

export function opaqueWidth(b: OpaqueBounds): number {
  return Math.max(0, b.maxX - b.minX)
}

export function opaqueHeight(b: OpaqueBounds): number {
  return Math.max(0, b.maxY - b.minY)
}
