/**
 * Retro park scoreboard + per-ring target point values.
 * Timed mode is optional (see SCOREBOARD_TIMED_MODE).
 */

/**
 * Front (smallest / nearest) → back (largest / deepest): harder rows worth more.
 * Game score adds exactly these values per peg hit (matches on-disc labels).
 */
export const TARGET_RING_POINTS: readonly [number, number, number] = [
  50, 100, 150,
]

export function targetPointsForRing(ringIndex: number): number {
  return TARGET_RING_POINTS[ringIndex] ?? TARGET_RING_POINTS[0]
}

/** Reserved for floating / bonus targets (wire when those pegs exist). */
export const SPECIAL_TARGET_POINTS = 250

export const SCOREBOARD_TIMED_MODE = false

export const SCOREBOARD_TIME_LIMIT_SEC = 90

const FONT_TITLE =
  '600 11px "Oswald", "Arial Narrow", system-ui, sans-serif'
const FONT_LABEL =
  '600 12px "Oswald", "Arial Narrow", system-ui, sans-serif'
const FONT_SCORE =
  '400 56px "Bebas Neue", Impact, "Arial Narrow", sans-serif'
const FONT_TIME =
  '400 36px "Bebas Neue", Impact, "Arial Narrow", sans-serif'
const FONT_MULT =
  '400 30px "Bebas Neue", Impact, sans-serif'

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

/**
 * Large upper-right park board: smoked acrylic, lit frame, shallow perspective.
 */
export function drawRetroScoreboard(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  p: ScoreboardDrawParams
): void {
  const m = Math.min(w, h)
  const marginX = m * 0.022 + 14
  const marginY = m * 0.02 + 12

  const panelW = Math.max(268, Math.min(400, m * 0.46))
  const hasMult = (p.comboMultiplier ?? 1) > 1.001
  const panelH = hasMult ? 248 : 206

  const x0 = w - marginX - panelW
  const y0 = marginY

  ctx.save()

  ctx.translate(x0, y0)
  ctx.transform(1, 0, 0.055, 1, 0, 0)

  const r = 10
  const inset = 3

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
  ctx.roundRect(inset, inset, panelW - inset * 2, panelH * 0.48, r - inset)
  ctx.fill()

  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.roundRect(0, 0, panelW, panelH, r)
  ctx.stroke()

  ctx.strokeStyle = 'rgba(95, 175, 160, 0.55)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.roundRect(1.5, 1.5, panelW - 3, panelH - 3, r - 1)
  ctx.stroke()

  ctx.strokeStyle = 'rgba(255, 205, 150, 0.35)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(3, 3, panelW - 6, panelH - 6, r - 2)
  ctx.stroke()

  const padX = 20
  ctx.textAlign = 'left'

  let cursorY = 16
  ctx.textBaseline = 'top'
  ctx.font = FONT_TITLE
  ctx.fillStyle = 'rgba(195, 228, 215, 0.75)'
  ctx.fillText('NIGHT PARK', padX, cursorY)
  cursorY += 24

  ctx.font = FONT_LABEL
  ctx.fillStyle = 'rgba(160, 210, 195, 0.9)'
  ctx.fillText('SCORE', padX, cursorY)
  cursorY += 22

  const scoreStr = p.score.toLocaleString()
  ctx.textBaseline = 'alphabetic'
  ctx.font = FONT_SCORE
  const scoreBaseline = cursorY + 46
  ctx.lineWidth = 4
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'
  ctx.strokeText(scoreStr, padX, scoreBaseline)
  ctx.fillStyle = 'rgba(255, 248, 235, 0.98)'
  ctx.fillText(scoreStr, padX, scoreBaseline)

  cursorY = scoreBaseline + 14
  ctx.textBaseline = 'top'
  ctx.font = FONT_LABEL
  ctx.fillStyle = 'rgba(160, 210, 195, 0.9)'
  ctx.fillText('TIME', padX, cursorY)
  cursorY += 22

  const timeStr =
    p.timedMode && p.timerRemainingSec != null
      ? formatTimerMmSs(p.timerRemainingSec)
      : '—:—'
  ctx.textBaseline = 'alphabetic'
  ctx.font = FONT_TIME
  const timeBaseline = cursorY + 30
  ctx.lineWidth = 3.5
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)'
  ctx.strokeText(timeStr, padX, timeBaseline)
  ctx.fillStyle =
    p.timedMode && p.timerRemainingSec != null && p.timerRemainingSec <= 10
      ? 'rgba(255, 195, 155, 0.98)'
      : 'rgba(225, 248, 238, 0.95)'
  ctx.fillText(timeStr, padX, timeBaseline)

  if (hasMult) {
    let my = timeBaseline + 12
    ctx.textBaseline = 'top'
    ctx.font = FONT_LABEL
    ctx.fillStyle = 'rgba(160, 210, 195, 0.9)'
    ctx.fillText('MULT', padX, my)
    my += 22
    ctx.textBaseline = 'alphabetic'
    ctx.font = FONT_MULT
    const multStr = `×${(p.comboMultiplier ?? 1).toFixed(1)}`
    const multBase = my + 28
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)'
    ctx.strokeText(multStr, padX, multBase)
    ctx.fillStyle = 'rgba(255, 225, 175, 0.98)'
    ctx.fillText(multStr, padX, multBase)
  }

  ctx.restore()
}
