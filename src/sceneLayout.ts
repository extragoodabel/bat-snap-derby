/**
 * Single responsive scale: logical canvas (w×h) vs reference design (2048×1152).
 * Pixel-like tuning constants should be expressed in design space and converted with `designPx`.
 */

export const DESIGN_REF_W = 2048
export const DESIGN_REF_H = 1152

/** Logical field aspect — matches layered `bg-sky` / `bg-field` art. */
export const BOARD_DESIGN_ASPECT = DESIGN_REF_W / DESIGN_REF_H

export type SceneLayout = {
  w: number
  h: number
  /** min(w / DESIGN_REF_W, h / DESIGN_REF_H) — uniform scene vs design reference */
  scale: number
}

export function computeSceneLayout(w: number, h: number): SceneLayout {
  return {
    w,
    h,
    scale: Math.min(w / DESIGN_REF_W, h / DESIGN_REF_H),
  }
}

/** Convert a distance tuned at 2048×1152 into current logical pixels. */
export function designPx(layout: SceneLayout, designPixels: number): number {
  return designPixels * layout.scale
}

// --- Gallery / field offsets (tuned at design resolution) -------------------

export const GALLERY_ROOT_OFFSET_Y_DESIGN = 100
export const GALLERY_RING_SHIFT_MID_DESIGN = 28
export const GALLERY_RING_SHIFT_BACK_DESIGN = 52

// --- Hero / interaction (design px) -----------------------------------------

export const STATUE_NUDGE_X_DESIGN = -27
export const STATUE_FIT_PAD_DESIGN = 14.4

export const PITCH_MOUND_NUDGE_UP_DESIGN = 100

export const CONTACT_ZONE_R_DESIGN = 248
export const BALL_R_DESIGN = 9
export const GRAB_THRESH_BASE_DESIGN = 52

// --- Power bar (design px) --------------------------------------------------

export const POWER_BAR_GAP_ABOVE_SWING_DESIGN = 12
export const POWER_BAR_LABEL_CLEARANCE_DESIGN = 10
export const POWER_BAR_DROP_TOWARD_PIVOT_DESIGN = 64
export const POWER_BAR_HEIGHT_DESIGN = 34
export const POWER_BAR_MIN_WIDTH_DESIGN = 168
