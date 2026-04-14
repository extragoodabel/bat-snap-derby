import type { Vec2 } from './physics'

/**
 * Public folder URLs (Vite serves `public/` at site root).
 * Try lowercase then `.PNG` — deployment may be case-sensitive while macOS often is not.
 */
const SPRITE_URL_CANDIDATES = {
  bg: ['/assets/bg-stadium.png', '/assets/bg-stadium.PNG'],
  statue: ['/assets/statue.png', '/assets/statue.PNG'],
  bat: ['/assets/bat.png', '/assets/bat.PNG'],
} as const

export type LoadedGameSprites = {
  bg: HTMLImageElement
  statue: HTMLImageElement
  bat: HTMLImageElement
}

export type SpriteLayout = {
  /** World grip point = sim.pivot; same as statue hand anchor. */
  pivot: Vec2
  batLen: number
  statueX: number
  statueY: number
  statueW: number
  statueH: number
  /** statueDrawH / statue natural height */
  statueUniformScale: number
  /** Hand grip pixel in statue source (natural coords, from image top-left). */
  statueHandNatX: number
  statueHandNatY: number
  batRotDeltaRad: number
  batKnobXPxNat: number
  batKnobYPxNat: number
  batDrawW: number
  batDrawH: number
  batNatW: number
  batNatH: number
  batUniformScale: number
}

/** Single world anchor: physics pivot + statue hand + bat handle base (fractions of canvas). */
const STATUE_ANCHOR_X_FR = 0.84
const STATUE_ANCHOR_Y_FR = 0.78

/** Statue drawn height as fraction of canvas height (32–38% band, mid 34%). */
const STATUE_HEIGHT_FR = 0.34
/** Bat bitmap height target vs statue drawn height. */
const BAT_DRAW_HEIGHT_FR_OF_STATUE = 0.9

/**
 * Grip on statue texture: fraction of natural width/height from image top-left.
 * Tune until debug blue (hand) meets red (anchor) — they coincide by placement math when correct.
 */
const STATUE_HAND_NAT_X_FR = 0.752
const STATUE_HAND_NAT_Y_FR = 0.768

/** Handle base (rotation pivot) in bat texture — fractions of natural size. */
const BAT_KNOB_U = 0.756
const BAT_KNOB_V = 0.77
/** Barrel tip — physics length + sprite axis vs game θ. */
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

export function loadGameSprites(): Promise<LoadedGameSprites> {
  return Promise.all([
    loadImageDecoded(SPRITE_URL_CANDIDATES.bg),
    loadImageDecoded(SPRITE_URL_CANDIDATES.statue),
    loadImageDecoded(SPRITE_URL_CANDIDATES.bat),
  ]).then(([bg, statue, bat]) => ({ bg, statue, bat }))
}

/** width ÷ height of the stadium art; used to size the logical game board. */
export function getStadiumImageAspectRatio(img: HTMLImageElement): number {
  const iw = img.naturalWidth
  const ih = img.naturalHeight
  if (iw < 1 || ih < 1) return 16 / 9
  return iw / ih
}

export function computeSpriteLayout(
  w: number,
  h: number,
  statueImg: HTMLImageElement,
  batImg: HTMLImageElement
): SpriteLayout {
  const sNatW = statueImg.naturalWidth
  const sNatH = statueImg.naturalHeight
  const bNatW = batImg.naturalWidth
  const bNatH = batImg.naturalHeight

  const pivot: Vec2 = {
    x: w * STATUE_ANCHOR_X_FR,
    y: h * STATUE_ANCHOR_Y_FR,
  }

  const statueDrawH = h * STATUE_HEIGHT_FR
  const statueUniformScale = statueDrawH / sNatH
  const statueW = sNatW * statueUniformScale
  const statueH = sNatH * statueUniformScale

  const statueHandNatX = STATUE_HAND_NAT_X_FR * sNatW
  const statueHandNatY = STATUE_HAND_NAT_Y_FR * sNatH

  const statueX = pivot.x - statueHandNatX * statueUniformScale
  const statueY = pivot.y - statueHandNatY * statueUniformScale

  const targetBatDrawH = statueDrawH * BAT_DRAW_HEIGHT_FR_OF_STATUE
  const batUniformScale = targetBatDrawH / bNatH
  const batDrawW = bNatW * batUniformScale
  const batDrawH = bNatH * batUniformScale

  const batKnobXPxNat = BAT_KNOB_U * bNatW
  const batKnobYPxNat = BAT_KNOB_V * bNatH

  const vTipX = (BAT_TIP_U - BAT_KNOB_U) * bNatW
  const vTipY = (BAT_TIP_V - BAT_KNOB_V) * bNatH
  const batLen = Math.hypot(vTipX, vTipY) * batUniformScale
  const batRotDeltaRad = -Math.PI / 2 - Math.atan2(vTipY, vTipX)

  return {
    pivot,
    batLen,
    statueX,
    statueY,
    statueW,
    statueH,
    statueUniformScale,
    statueHandNatX,
    statueHandNatY,
    batRotDeltaRad,
    batKnobXPxNat,
    batKnobYPxNat,
    batDrawW,
    batDrawH,
    batNatW: bNatW,
    batNatH: bNatH,
    batUniformScale,
  }
}

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
  ctx.drawImage(img, dx, dy, dw, dh)
}

export function drawStatueSprite(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  layout: Pick<
    SpriteLayout,
    'statueX' | 'statueY' | 'statueW' | 'statueH'
  >
): void {
  ctx.drawImage(img, layout.statueX, layout.statueY, layout.statueW, layout.statueH)
}

/**
 * Bat rotates around statue hand pivot; knob drawn at (pivot) after transform.
 * ctx.translate(pivot) → rotate(θ + δ) → drawImage with top-left at (−knob*scale).
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
    batDrawW,
    batDrawH,
    batNatW,
    batNatH,
    batUniformScale,
  } = layout
  ctx.save()
  ctx.translate(pivot.x, pivot.y)
  ctx.rotate(thetaRad + batRotDeltaRad)
  ctx.drawImage(
    batImg,
    0,
    0,
    batNatW,
    batNatH,
    -batKnobXPxNat * batUniformScale,
    -batKnobYPxNat * batUniformScale,
    batDrawW,
    batDrawH
  )
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
    statueHandNatX,
    statueHandNatY,
    statueUniformScale,
    batRotDeltaRad,
    batKnobXPxNat,
    batKnobYPxNat,
    batNatW,
    batNatH,
    batUniformScale,
  } = layout
  const phi = thetaRad + batRotDeltaRad
  const c = Math.cos(phi)
  const s = Math.sin(phi)

  const handWx = statueX + statueHandNatX * statueUniformScale
  const handWy = statueY + statueHandNatY * statueUniformScale

  const kx = batKnobXPxNat * batUniformScale
  const ky = batKnobYPxNat * batUniformScale
  const tlX = pivot.x + c * (-kx) - s * (-ky)
  const tlY = pivot.y + s * (-kx) + c * (-ky)
  const knobWx = tlX + c * kx - s * ky
  const knobWy = tlY + s * kx + c * ky

  const corners: Vec2[] = [
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

  ctx.save()
  ctx.strokeStyle = 'rgba(0, 255, 255, 0.55)'
  ctx.lineWidth = 1.25
  ctx.beginPath()
  ctx.moveTo(corners[0].x, corners[0].y)
  for (let i = 1; i < corners.length; i++) {
    ctx.lineTo(corners[i].x, corners[i].y)
  }
  ctx.closePath()
  ctx.stroke()

  const dot = (x: number, y: number, color: string, radius: number) => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
  }

  dot(pivot.x, pivot.y, 'rgba(255, 40, 40, 0.95)', 6)
  dot(handWx, handWy, 'rgba(60, 120, 255, 0.95)', 5)
  dot(knobWx, knobWy, 'rgba(40, 220, 90, 0.95)', 4)

  const deg = (thetaRad * 180) / Math.PI
  ctx.font = '11px ui-monospace, monospace'
  ctx.fillStyle = 'rgba(255, 255, 200, 0.95)'
  ctx.fillText(`θ=${deg.toFixed(1)}°`, pivot.x + 10, pivot.y - 12)
  ctx.fillStyle = 'rgba(200,200,200,0.85)'
  ctx.font = '9px ui-monospace, monospace'
  ctx.fillText('R pivot  B hand  G bat knob', pivot.x + 10, pivot.y + 4)
  ctx.restore()
}
