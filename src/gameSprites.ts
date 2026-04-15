import type { Vec2 } from './physics'
import {
  designPx,
  STATUE_FIT_PAD_DESIGN,
  STATUE_NUDGE_X_DESIGN,
  type SceneLayout,
} from './sceneLayout'
import {
  measureOpaqueBounds,
  opaqueHeight,
  opaqueWidth,
  type OpaqueBounds,
} from './spriteOpaqueBounds'

/**
 * Public folder URLs (Vite serves `public/` at site root).
 * Try lowercase then `.PNG` — deployment may be case-sensitive while macOS often is not.
 */
const SPRITE_URL_CANDIDATES = {
  /** Stadium: WebP only (regenerate with `npm run assets:webp-bg` if missing). */
  bg: ['/assets/bg-stadium.webp', '/assets/bg-stadium.WEBP'],
  /** Sprites: WebP (`npm run assets:webp-sprites` to regenerate from PNGs). */
  statue: ['/assets/statue.webp', '/assets/statue.WEBP'],
  bat: ['/assets/bat.webp', '/assets/bat.WEBP'],
} as const

export type LoadedGameSprites = {
  bg: HTMLImageElement
  statue: HTMLImageElement
  bat: HTMLImageElement
  statueOpaque: OpaqueBounds
  batOpaque: OpaqueBounds
}

export type { OpaqueBounds }

export type SpriteLayout = {
  /** World grip point = sim.pivot; same as statue hand anchor. */
  pivot: Vec2
  batLen: number
  /** Cropped draw dest (visible / opaque region scaled). */
  statueX: number
  statueY: number
  statueW: number
  statueH: number
  statueSrcX: number
  statueSrcY: number
  statueSrcW: number
  statueSrcH: number
  /** Scene px per 1 source px within the cropped statue rect. */
  statueUniformScale: number
  /** Hand in full-image natural coords (for reference). */
  statueHandNatX: number
  statueHandNatY: number
  /** Hand relative to statueSrc top-left (source pixels). */
  statueHandInVisX: number
  statueHandInVisY: number
  /** Hand UV clamped into statue opaque bounds (full-image px); spring / connectors. */
  statueHandSpringNatX: number
  statueHandSpringNatY: number
  statueHandSpringInVisX: number
  statueHandSpringInVisY: number
  statueFullNatW: number
  statueFullNatH: number
  statueOpaque: OpaqueBounds

  batRotDeltaRad: number
  batKnobXPxNat: number
  batKnobYPxNat: number
  batKnobInVisX: number
  batKnobInVisY: number
  batDrawW: number
  batDrawH: number
  batSrcX: number
  batSrcY: number
  batSrcW: number
  batSrcH: number
  batNatW: number
  batNatH: number
  batUniformScale: number
  batOpaque: OpaqueBounds
}

/**
 * Single meet point: sim.pivot, statue-hand grip (UV below), and bat pivot at the
 * bottom-center of the bat’s opaque bounds (true bottom of the cropped sprite).
 */
const STATUE_ANCHOR_X_FR = 0.805
const STATUE_ANCHOR_Y_FR = 0.789

/** Visible statue height target — reduced vs full-PNG scale so figure matches stadium depth. */
const STATUE_HEIGHT_FR = 0.21
/** Applied after fit/height scale (e.g. 1.05 = 5% larger). */
const STATUE_SCALE_MUL = 1.05
/** Bat visible height vs statue visible height. */
const BAT_DRAW_HEIGHT_FR_OF_STATUE = 0.88

/**
 * Grip on statue texture: fraction of natural width/height from image top-left.
 */
const STATUE_HAND_NAT_X_FR = 0.752
const STATUE_HAND_NAT_Y_FR = 0.778

/** Barrel tip in full texture (UV) — defines bat axis vs game θ and tip distance. */
const BAT_TIP_U = 0.392
const BAT_TIP_V = 0.125

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
    (chain, src) =>
      chain.catch(() => tryUrl(src)),
    Promise.reject(new Error('no-url'))
  )
}

async function loadImageDecoded(urls: readonly string[]): Promise<HTMLImageElement> {
  const im = await loadImageFirstMatch(urls)
  if (im.decode) {
    try {
      await im.decode()
    } catch {
      /* decode optional; onload already fired */
    }
  }
  return im
}

export async function loadGameSprites(): Promise<LoadedGameSprites> {
  const [bg, statue, bat] = await Promise.all([
    loadImageDecoded(SPRITE_URL_CANDIDATES.bg),
    loadImageDecoded(SPRITE_URL_CANDIDATES.statue),
    loadImageDecoded(SPRITE_URL_CANDIDATES.bat),
  ])
  const statueOpaque = measureOpaqueBounds(statue)
  const batOpaque = measureOpaqueBounds(bat)
  return { bg, statue, bat, statueOpaque, batOpaque }
}

/** width ÷ height of the stadium art; used to size the logical game board. */
export function getStadiumImageAspectRatio(img: HTMLImageElement): number {
  const iw = img.naturalWidth
  const ih = img.naturalHeight
  if (iw < 1 || ih < 1) return 16 / 9
  return iw / ih
}

/** Max statue scale so opaque rect + pivot stays inside canvas (hand at pivot). */
function maxStatueScaleToFitCanvas(
  pivot: Vec2,
  canvasW: number,
  canvasH: number,
  pad: number,
  srcW: number,
  srcH: number,
  handInVisX: number,
  handInVisY: number
): number {
  let sMax = Number.POSITIVE_INFINITY
  const { x: px, y: py } = pivot
  if (handInVisX > 1e-6) {
    sMax = Math.min(sMax, (px - pad) / handInVisX)
  }
  if (handInVisY > 1e-6) {
    sMax = Math.min(sMax, (py - pad) / handInVisY)
  }
  const spanRight = srcW - handInVisX
  if (spanRight > 1e-6) {
    sMax = Math.min(sMax, (canvasW - pad - px) / spanRight)
  }
  const spanDown = srcH - handInVisY
  if (spanDown > 1e-6) {
    sMax = Math.min(sMax, (canvasH - pad - py) / spanDown)
  }
  return Math.max(1e-9, sMax)
}

/**
 * Distance from (ox,oy) along unit direction (dx,dy) to the first exit from the
 * half-open AABB [left,right)×[top,bottom) — bounds of the cropped bat bitmap in
 * source pixels. Caps mechanical bat length so arcs don’t exceed the sprite.
 */
function distanceAlongRayToExitAabb(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  left: number,
  top: number,
  right: number,
  bottom: number
): number {
  let tMax = Infinity
  if (dx > 1e-9) tMax = Math.min(tMax, (right - ox) / dx)
  else if (dx < -1e-9) tMax = Math.min(tMax, (left - ox) / dx)
  if (dy > 1e-9) tMax = Math.min(tMax, (bottom - oy) / dy)
  else if (dy < -1e-9) tMax = Math.min(tMax, (top - oy) / dy)
  if (!Number.isFinite(tMax) || tMax <= 0) return 0
  return tMax
}

export function computeSpriteLayout(
  w: number,
  h: number,
  statueImg: HTMLImageElement,
  batImg: HTMLImageElement,
  statueOpaque: OpaqueBounds,
  batOpaque: OpaqueBounds,
  layout: SceneLayout
): SpriteLayout {
  const sNatW = statueImg.naturalWidth
  const sNatH = statueImg.naturalHeight
  const bNatW = batImg.naturalWidth
  const bNatH = batImg.naturalHeight

  const sVisW = opaqueWidth(statueOpaque)
  const sVisH = opaqueHeight(statueOpaque)
  const bVisW = opaqueWidth(batOpaque)
  const bVisH = opaqueHeight(batOpaque)

  const pivot: Vec2 = {
    x: w * STATUE_ANCHOR_X_FR,
    y: h * STATUE_ANCHOR_Y_FR,
  }

  const statueSrcX = statueOpaque.minX
  const statueSrcY = statueOpaque.minY
  const statueSrcW = sVisW > 0 ? sVisW : sNatW
  const statueSrcH = sVisH > 0 ? sVisH : sNatH

  const statueHandNatX = STATUE_HAND_NAT_X_FR * sNatW
  const statueHandNatY = STATUE_HAND_NAT_Y_FR * sNatH
  const statueHandInVisX = statueHandNatX - statueSrcX
  const statueHandInVisY = statueHandNatY - statueSrcY

  const omx0 = statueOpaque.minX
  const omy0 = statueOpaque.minY
  const omx1 = statueOpaque.maxX - 1e-6
  const omy1 = statueOpaque.maxY - 1e-6
  const statueHandSpringNatX = Math.max(omx0, Math.min(omx1, statueHandNatX))
  const statueHandSpringNatY = Math.max(omy0, Math.min(omy1, statueHandNatY))
  const statueHandSpringInVisX = statueHandSpringNatX - statueSrcX
  const statueHandSpringInVisY = statueHandSpringNatY - statueSrcY

  const targetStatueVisH = h * STATUE_HEIGHT_FR
  const sFromHeight =
    sVisH > 0 ? targetStatueVisH / sVisH : targetStatueVisH / Math.max(1, sNatH)
  const pad = designPx(layout, STATUE_FIT_PAD_DESIGN)
  const sFit = maxStatueScaleToFitCanvas(
    pivot,
    w,
    h,
    pad,
    statueSrcW,
    statueSrcH,
    statueHandSpringInVisX,
    statueHandSpringInVisY
  )
  let statueUniformScale = Math.min(sFromHeight, sFit) * STATUE_SCALE_MUL

  const nudgeX = designPx(layout, STATUE_NUDGE_X_DESIGN)

  /** Keep statue in frame when hand is locked to pivot (bottom may sit above field edge). */
  const spanBelowHand = statueSrcH - statueHandSpringInVisY
  if (spanBelowHand > 1e-3) {
    const sMaxBottom =
      (h - pad - pivot.y) / spanBelowHand
    if (Number.isFinite(sMaxBottom) && sMaxBottom > 0) {
      statueUniformScale = Math.min(statueUniformScale, sMaxBottom)
    }
  }

  const statueW = statueSrcW * statueUniformScale
  const statueH = statueSrcH * statueUniformScale

  const handWX = statueHandSpringInVisX * statueUniformScale
  const handWY = statueHandSpringInVisY * statueUniformScale
  /** Single hero anchor: spring hand meets bat pivot in world space. */
  const statueX = pivot.x - handWX + nudgeX
  const statueY = pivot.y - handWY

  const targetBatVisH = statueH * BAT_DRAW_HEIGHT_FR_OF_STATUE
  const batUniformScale =
    bVisH > 0 ? targetBatVisH / bVisH : targetBatVisH / Math.max(1, bNatH)

  const batSrcX = batOpaque.minX
  const batSrcY = batOpaque.minY
  const batSrcW = bVisW > 0 ? bVisW : bNatW
  const batSrcH = bVisH > 0 ? bVisH : bNatH

  const batDrawW = batSrcW * batUniformScale
  const batDrawH = batSrcH * batUniformScale

  /** Pivot = bottom-center of opaque bat (maxY is exclusive → bottom edge of sprite). */
  const batKnobXPxNat = (batOpaque.minX + batOpaque.maxX) / 2
  const batKnobYPxNat = batOpaque.maxY
  const batKnobInVisX = batKnobXPxNat - batSrcX
  const batKnobInVisY = batKnobYPxNat - batSrcY

  const vTipX = BAT_TIP_U * bNatW - batKnobXPxNat
  const vTipY = BAT_TIP_V * bNatH - batKnobYPxNat
  const dirLen = Math.hypot(vTipX, vTipY) || 1
  const udx = vTipX / dirLen
  const udy = vTipY / dirLen
  const boxL = batSrcX
  const boxT = batSrcY
  const boxR = batSrcX + batSrcW
  const boxB = batSrcY + batSrcH
  const tExitPx = distanceAlongRayToExitAabb(
    batKnobXPxNat,
    batKnobYPxNat,
    udx,
    udy,
    boxL,
    boxT,
    boxR,
    boxB
  )
  const lenFromTipUv = dirLen * batUniformScale
  const lenFromBounds =
    tExitPx > 1e-6 ? tExitPx * batUniformScale : lenFromTipUv
  const batLen = Math.min(lenFromTipUv, lenFromBounds)
  /**
   * Game bat angle θ uses tip at (cos θ, sin θ); THETA_UP = −π/2 is screen-up.
   * After translate(pivot), `rotate(θ + batRotDelta)` must map the bitmap knob→tip
   * vector (vTip) onto that ray. With canvas clockwise-positive rotate, that is
   * batRotDelta = −atan2(vTipY, vTipX) — no extra −π/2 (that was wrong once the
   * pivot moved to bottom-center; it skewed “sprite north” ~90° off).
   */
  const batRotDeltaRad = -Math.atan2(vTipY, vTipX)

  return {
    pivot,
    batLen,
    statueX,
    statueY,
    statueW,
    statueH,
    statueSrcX,
    statueSrcY,
    statueSrcW,
    statueSrcH,
    statueUniformScale,
    statueHandNatX,
    statueHandNatY,
    statueHandInVisX,
    statueHandInVisY,
    statueHandSpringNatX,
    statueHandSpringNatY,
    statueHandSpringInVisX,
    statueHandSpringInVisY,
    statueFullNatW: sNatW,
    statueFullNatH: sNatH,
    statueOpaque: { ...statueOpaque },
    batRotDeltaRad,
    batKnobXPxNat,
    batKnobYPxNat,
    batKnobInVisX,
    batKnobInVisY,
    batDrawW,
    batDrawH,
    batSrcX,
    batSrcY,
    batSrcW,
    batSrcH,
    batNatW: bNatW,
    batNatH: bNatH,
    batUniformScale,
    batOpaque: { ...batOpaque },
  }
}

/** Logical playfield / letterbox void — keep in sync with `--stage-void` in `index.css`. */
export const STAGE_VOID_HEX = '#060a12'

/**
 * Full stadium layer: CSS `background-size: contain`, centered.
 * Entire image stays visible; when the canvas aspect matches the asset, it fills w×h.
 * Default compositing preserves PNG alpha over whatever is already drawn.
 */
export function drawBackgroundImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number
): void {
  const iw = img.naturalWidth
  const ih = img.naturalHeight
  if (iw < 1 || ih < 1) return
  const scale = Math.min(w / iw, h / ih)
  const dw = iw * scale
  const dh = ih * scale
  const dx = (w - dw) / 2
  const dy = (h - dh) / 2
  /* Letterbox/pillarbox bands stay void-colored, not transparent (avoids white compositor flash). */
  ctx.fillStyle = STAGE_VOID_HEX
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, dx, dy, dw, dh)
}

export function drawStatueSprite(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  layout: Pick<
    SpriteLayout,
    | 'statueX'
    | 'statueY'
    | 'statueW'
    | 'statueH'
    | 'statueSrcX'
    | 'statueSrcY'
    | 'statueSrcW'
    | 'statueSrcH'
  >
): void {
  ctx.drawImage(
    img,
    layout.statueSrcX,
    layout.statueSrcY,
    layout.statueSrcW,
    layout.statueSrcH,
    layout.statueX,
    layout.statueY,
    layout.statueW,
    layout.statueH
  )
}

/**
 * Bat: mechanical pivot = visible knob. Knob must be expressed in **crop-local**
 * pixels (full-image knob minus batSrc*), then dest offset = −(knobLocal/srcSize)*destSize
 * so that source pixel (knobFull) maps to world pivot after translate→rotate.
 */
export function drawBatSprite(
  ctx: CanvasRenderingContext2D,
  batImg: HTMLImageElement,
  layout: SpriteLayout,
  thetaRad: number
): void {
  const {
    pivot,
    batRotDeltaRad,
    batKnobXPxNat,
    batKnobYPxNat,
    batSrcX,
    batSrcY,
    batSrcW,
    batSrcH,
    batUniformScale,
  } = layout

  const knobLocalX = batKnobXPxNat - batSrcX
  const knobLocalY = batKnobYPxNat - batSrcY
  const sw = Math.max(1, batSrcW)
  const sh = Math.max(1, batSrcH)
  const dw = sw * batUniformScale
  const dh = sh * batUniformScale
  const dxDest = -(knobLocalX / sw) * dw
  const dyDest = -(knobLocalY / sh) * dh

  ctx.save()
  ctx.translate(pivot.x, pivot.y)
  ctx.rotate(thetaRad + batRotDeltaRad)
  const prevSmooth = ctx.imageSmoothingEnabled
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(batImg, batSrcX, batSrcY, sw, sh, dxDest, dyDest, dw, dh)
  ctx.imageSmoothingEnabled = prevSmooth
  ctx.restore()
}

/**
 * Red = sim pivot / anchor. Blue = statue hand from texture + placement.
 * Green = bat knob in world via full transform chain (must match red when aligned).
 */
export function drawSpriteDebugOverlay(
  ctx: CanvasRenderingContext2D,
  layout: SpriteLayout,
  thetaRad: number
): void {
  const {
    pivot,
    statueX,
    statueY,
    statueW,
    statueH,
    statueUniformScale,
    statueHandInVisX,
    statueHandInVisY,
    statueFullNatW,
    statueFullNatH,
    statueOpaque,
    batRotDeltaRad,
    batKnobXPxNat,
    batKnobYPxNat,
    batKnobInVisX,
    batKnobInVisY,
    batNatW,
    batNatH,
    batSrcW,
    batSrcH,
    batUniformScale,
  } = layout
  const phi = thetaRad + batRotDeltaRad
  const c = Math.cos(phi)
  const s = Math.sin(phi)

  const handWx = statueX + statueHandInVisX * statueUniformScale
  const handWy = statueY + statueHandInVisY * statueUniformScale

  const swD = Math.max(1, batSrcW)
  const shD = Math.max(1, batSrcH)
  const dwDbg = swD * batUniformScale
  const dhDbg = shD * batUniformScale
  const dxD = -(batKnobInVisX / swD) * dwDbg
  const dyD = -(batKnobInVisY / shD) * dhDbg
  const fracKnobX = batKnobInVisX / swD
  const fracKnobY = batKnobInVisY / shD
  const lxKnob = dxD + fracKnobX * dwDbg
  const lyKnob = dyD + fracKnobY * dhDbg
  const knobWx = pivot.x + c * lxKnob - s * lyKnob
  const knobWy = pivot.y + s * lxKnob + c * lyKnob

  const cornersCropped: Vec2[] = [
    { x: 0, y: 0 },
    { x: batSrcW, y: 0 },
    { x: batSrcW, y: batSrcH },
    { x: 0, y: batSrcH },
  ].map((p) => {
    const lx = (p.x - batKnobInVisX) * batUniformScale
    const ly = (p.y - batKnobInVisY) * batUniformScale
    return {
      x: pivot.x + lx * c - ly * s,
      y: pivot.y + lx * s + ly * c,
    }
  })

  ctx.save()

  const statueFullLeft =
    statueX - statueOpaque.minX * statueUniformScale
  const statueFullTop =
    statueY - statueOpaque.minY * statueUniformScale
  const statueFullW = statueFullNatW * statueUniformScale
  const statueFullH = statueFullNatH * statueUniformScale

  ctx.strokeStyle = 'rgba(255, 0, 255, 0.85)'
  ctx.lineWidth = 2
  ctx.setLineDash([6, 4])
  ctx.strokeRect(statueFullLeft, statueFullTop, statueFullW, statueFullH)
  ctx.strokeStyle = 'rgba(0, 255, 80, 0.9)'
  ctx.setLineDash([4, 3])
  ctx.strokeRect(statueX, statueY, statueW, statueH)
  ctx.setLineDash([])

  const batCornersFull: Vec2[] = [
    { x: 0, y: 0 },
    { x: batNatW, y: 0 },
    { x: batNatW, y: batNatH },
    { x: 0, y: batNatH },
  ].map((p) => {
    const lx = (p.x - batKnobXPxNat) * batUniformScale
    const ly = (p.y - batKnobYPxNat) * batUniformScale
    return {
      x: pivot.x + lx * c - ly * s,
      y: pivot.y + lx * s + ly * c,
    }
  })
  ctx.strokeStyle = 'rgba(255, 100, 255, 0.75)'
  ctx.lineWidth = 1.75
  ctx.beginPath()
  ctx.moveTo(batCornersFull[0].x, batCornersFull[0].y)
  for (let i = 1; i < batCornersFull.length; i++) {
    ctx.lineTo(batCornersFull[i].x, batCornersFull[i].y)
  }
  ctx.closePath()
  ctx.stroke()

  ctx.strokeStyle = 'rgba(0, 255, 255, 0.55)'
  ctx.lineWidth = 1.25
  ctx.beginPath()
  ctx.moveTo(cornersCropped[0].x, cornersCropped[0].y)
  for (let i = 1; i < cornersCropped.length; i++) {
    ctx.lineTo(cornersCropped[i].x, cornersCropped[i].y)
  }
  ctx.closePath()
  ctx.stroke()

  const dot = (x: number, y: number, color: string, radius: number) => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
  }

  dot(pivot.x, pivot.y, 'rgba(255, 40, 40, 0.95)', 7)
  dot(handWx, handWy, 'rgba(60, 120, 255, 0.95)', 5)
  dot(knobWx, knobWy, 'rgba(40, 255, 80, 0.95)', 5)
  if (Math.hypot(lxKnob, lyKnob) > 0.5) {
    ctx.strokeStyle = 'rgba(255, 120, 0, 0.95)'
    ctx.lineWidth = 2
    ctx.strokeRect(knobWx - 6, knobWy - 6, 12, 12)
  }

  const deg = (thetaRad * 180) / Math.PI
  ctx.font = '11px ui-monospace, monospace'
  ctx.fillStyle = 'rgba(255, 255, 200, 0.95)'
  ctx.fillText(`θ=${deg.toFixed(1)}°`, pivot.x + 10, pivot.y - 12)
  ctx.fillStyle = 'rgba(200,200,200,0.85)'
  ctx.font = '9px ui-monospace, monospace'
  ctx.fillText(
    'R=pivot B=hand G=bat knob (must match R) | mag=statue full grn=statue crop',
    pivot.x + 10,
    pivot.y + 4
  )
  ctx.fillText(
    `knobLocal ${batKnobInVisX.toFixed(1)},${batKnobInVisY.toFixed(1)} / crop ${swD}×${shD}`,
    pivot.x + 10,
    pivot.y + 16
  )
  ctx.restore()
}
