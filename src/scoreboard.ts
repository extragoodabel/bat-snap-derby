/**
 * Retro park scoreboard + per-ring target point values.
 * Timed mode is optional (see SCOREBOARD_TIMED_MODE).
 * All panel sizes / fonts scale with `layoutScale` (design reference 1600×900).
 */

/**
 * Front (smallest / nearest) → back (largest / deepest): harder rows worth more.
 * Game score adds exactly these values per peg hit (matches on-disc labels).
 */
export const TARGET_RING_POINTS: readonly [number, number, number] = [
  24, 51, 77,
]

export function targetPointsForRing(ringIndex: number): number {
  return TARGET_RING_POINTS[ringIndex] ?? TARGET_RING_POINTS[0]
}

/** Floating cloud + parachute payload hits. */
export const CLOUD_TARGET_POINTS = 116

export const SCOREBOARD_TIMED_MODE = false

export const SCOREBOARD_TIME_LIMIT_SEC = 90

/** Panel width at design scale = 1 (reference 1600×900). */
const SCOREBOARD_PANEL_W_DESIGN = 300
const SCOREBOARD_PANEL_H_DESIGN = 228
const SCOREBOARD_PANEL_H_MULT_DESIGN = 270

export function formatTimerMmSs(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds + 1e-6))
  const mm = Math.floor(s / 60)
  const ss = s % 60
  return `${mm}:${ss.toString().padStart(2, '0')}`
}

export type ScoreboardDrawParams = {
  score: number
  timedMode: boolean
  timerRemainingSec: number | null
  comboMultiplier?: number
}

export type ScoreboardScreenRect = {
  x: number
  y: number
  width: number
  height: number
}

function fontOswald(weight: number, designPx: number, scale: number): string {
  const px = Math.max(7, Math.round(designPx * scale))
  return `${weight} ${px}px "Oswald", "Arial Narrow", system-ui, sans-serif`
}

function fontBebas(weight: number, designPx: number, scale: number): string {
  const px = Math.max(10, Math.round(designPx * scale))
  return `${weight} ${px}px "Bebas Neue", Impact, "Arial Narrow", sans-serif`
}

/** Collegiate / classic ballpark wordmark (Google Font *Graduate*). */
function fontGraduate(designPx: number, scale: number): string {
  const px = Math.max(8, Math.round(designPx * scale))
  return `400 ${px}px "Graduate", "Ultra", "Rockwell", serif`
}

/**
 * Upper-right scoreboard box in **logical canvas** coords (axis-aligned; ignores skew transform).
 */
export function getScoreboardScreenRect(
  w: number,
  h: number,
  p: ScoreboardDrawParams,
  layoutScale: number,
  /** Slightly shrink board on tight mobile layouts (default 1). */
  scaleMul = 1
): ScoreboardScreenRect {
  const m = Math.min(w, h)
  const s = layoutScale * scaleMul
  const marginX = m * 0.022 + 14 * s
  const marginY = m * 0.02 + 12 * s
  const hasMult = (p.comboMultiplier ?? 1) > 1.001
  const panelW = Math.min(w * 0.44, SCOREBOARD_PANEL_W_DESIGN * s)
  const panelH = (hasMult ? SCOREBOARD_PANEL_H_MULT_DESIGN : SCOREBOARD_PANEL_H_DESIGN) * s
  const x0 = w - marginX - panelW
  const y0 = marginY
  return { x: x0, y: y0, width: panelW, height: panelH }
}

/**
 * Large upper-right park board: smoked acrylic, lit frame, shallow perspective.
 * @param layoutScale from `SceneLayout.scale` (min(w/1600, h/900)).
 */
export function drawRetroScoreboard(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  p: ScoreboardDrawParams,
  layoutScale: number,
  scaleMul = 1
): void {
  const m = Math.min(w, h)
  const s = layoutScale * scaleMul
  const marginX = m * 0.022 + 14 * s
  const marginY = m * 0.02 + 12 * s

  const hasMult = (p.comboMultiplier ?? 1) > 1.001
  const panelW = Math.min(w * 0.44, SCOREBOARD_PANEL_W_DESIGN * s)
  const panelH = (hasMult ? SCOREBOARD_PANEL_H_MULT_DESIGN : SCOREBOARD_PANEL_H_DESIGN) * s

  const x0 = w - marginX - panelW
  const y0 = marginY

  ctx.save()

  ctx.translate(x0, y0)
  ctx.transform(1, 0, 0.055, 1, 0, 0)

  const r = Math.max(4, 10 * s)
  const inset = Math.max(1.5, 3 * s)

  ctx.beginPath()
  ctx.roundRect(0, 0, panelW, panelH, r)

  const face = ctx.createLinearGradient(0, 0, panelW, panelH)
  face.addColorStop(0, 'rgba(14, 26, 32, 0.88)')
  face.addColorStop(0.35, 'rgba(10, 20, 26, 0.82)')
  face.addColorStop(0.7, 'rgba(8, 16, 22, 0.86)')
  face.addColorStop(1, 'rgba(6, 12, 18, 0.9)')
  ctx.fillStyle = face
  ctx.fill()

  const gloss = ctx.createLinearGradient(0, 0, 0, panelH * 0.52)
  gloss.addColorStop(0, 'rgba(255, 255, 255, 0.11)')
  gloss.addColorStop(0.4, 'rgba(190, 225, 210, 0.045)')
  gloss.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = gloss
  ctx.beginPath()
  ctx.roundRect(inset, inset, panelW - inset * 2, panelH * 0.48, Math.max(2, r - inset))
  ctx.fill()

  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'
  ctx.lineWidth = Math.max(1.25, 2.5 * s)
  ctx.beginPath()
  ctx.roundRect(0, 0, panelW, panelH, r)
  ctx.stroke()

  ctx.strokeStyle = 'rgba(95, 175, 160, 0.55)'
  ctx.lineWidth = Math.max(1, 1.5 * s)
  ctx.beginPath()
  ctx.roundRect(1.5 * s, 1.5 * s, panelW - 3 * s, panelH - 3 * s, Math.max(2, r - 1 * s))
  ctx.stroke()

  ctx.strokeStyle = 'rgba(255, 205, 150, 0.35)'
  ctx.lineWidth = Math.max(0.75, 1 * s)
  ctx.beginPath()
  ctx.roundRect(3 * s, 3 * s, panelW - 6 * s, panelH - 6 * s, Math.max(2, r - 2 * s))
  ctx.stroke()

  const padX = 20 * s
  ctx.textAlign = 'left'

  const titleMain = 'Bat Snap Derby'
  const titleSub = "Featuring Ichiro's Statue!"

  let cursorY = 14 * s
  ctx.textBaseline = 'top'

  let titleDesignPx = 15
  const maxTitleW = panelW - padX * 2 - 6 * s
  for (;;) {
    ctx.font = fontGraduate(titleDesignPx, s)
    if (ctx.measureText(titleMain).width <= maxTitleW || titleDesignPx <= 9) {
      break
    }
    titleDesignPx -= 1
  }

  ctx.font = fontGraduate(titleDesignPx, s)
  const titleMetrics = ctx.measureText(titleMain)
  const titleLineH =
    (titleMetrics.actualBoundingBoxAscent ?? 12 * s) +
    (titleMetrics.actualBoundingBoxDescent ?? 3 * s) +
    4 * s

  const titleY = cursorY
  ctx.save()
  try {
    ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing =
      `${Math.max(0.5, 1.1 * s)}px`
  } catch {
    /* letterSpacing not supported in all environments */
  }
  ctx.font = fontGraduate(titleDesignPx, s)
  ctx.lineWidth = Math.max(1.25, 2.4 * s)
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.58)'
  ctx.lineJoin = 'round'
  ctx.strokeText(titleMain, padX, titleY)
  ctx.fillStyle = 'rgba(255, 246, 232, 0.98)'
  ctx.fillText(titleMain, padX, titleY)
  ctx.restore()

  cursorY = titleY + titleLineH

  let subDesignPx = 8.5
  for (;;) {
    ctx.font = fontOswald(500, subDesignPx, s)
    if (ctx.measureText(titleSub).width <= maxTitleW || subDesignPx <= 6.5) {
      break
    }
    subDesignPx -= 0.5
  }
  ctx.fillStyle = 'rgba(175, 210, 198, 0.88)'
  ctx.fillText(titleSub, padX, cursorY)
  cursorY += Math.max(13 * s, (subDesignPx * s * 0.95 + 6 * s))

  ctx.font = fontOswald(600, 12, s)
  ctx.fillStyle = 'rgba(160, 210, 195, 0.9)'
  ctx.fillText('SCORE', padX, cursorY)
  cursorY += 22 * s

  const scoreStr = p.score.toLocaleString()
  ctx.textBaseline = 'alphabetic'
  ctx.font = fontBebas(400, 56, s)
  const scoreBaseline = cursorY + 46 * s
  ctx.lineWidth = Math.max(2, 4 * s)
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'
  ctx.strokeText(scoreStr, padX, scoreBaseline)
  ctx.fillStyle = 'rgba(255, 248, 235, 0.98)'
  ctx.fillText(scoreStr, padX, scoreBaseline)

  cursorY = scoreBaseline + 14 * s
  ctx.textBaseline = 'top'
  ctx.font = fontOswald(600, 12, s)
  ctx.fillStyle = 'rgba(160, 210, 195, 0.9)'
  ctx.fillText('TIME', padX, cursorY)
  cursorY += 22 * s

  const timeStr =
    p.timedMode && p.timerRemainingSec != null
      ? formatTimerMmSs(p.timerRemainingSec)
      : '—:—'
  ctx.textBaseline = 'alphabetic'
  ctx.font = fontBebas(400, 36, s)
  const timeBaseline = cursorY + 30 * s
  ctx.lineWidth = Math.max(2, 3.5 * s)
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)'
  ctx.strokeText(timeStr, padX, timeBaseline)
  ctx.fillStyle =
    p.timedMode && p.timerRemainingSec != null && p.timerRemainingSec <= 10
      ? 'rgba(255, 195, 155, 0.98)'
      : 'rgba(225, 248, 238, 0.95)'
  ctx.fillText(timeStr, padX, timeBaseline)

  if (hasMult) {
    let my = timeBaseline + 12 * s
    ctx.textBaseline = 'top'
    ctx.font = fontOswald(600, 12, s)
    ctx.fillStyle = 'rgba(160, 210, 195, 0.9)'
    ctx.fillText('MULT', padX, my)
    my += 22 * s
    ctx.textBaseline = 'alphabetic'
    ctx.font = fontBebas(400, 30, s)
    const multStr = `×${(p.comboMultiplier ?? 1).toFixed(1)}`
    const multBase = my + 28 * s
    ctx.lineWidth = Math.max(1.5, 3 * s)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)'
    ctx.strokeText(multStr, padX, multBase)
    ctx.fillStyle = 'rgba(255, 225, 175, 0.98)'
    ctx.fillText(multStr, padX, multBase)
  }

  ctx.restore()
}
