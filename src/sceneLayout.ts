/**
 * Single responsive scale: logical canvas (w×h) vs reference design (2048×1152).
 * Pixel-like tuning constants should be expressed in design space and converted with `designPx`.
 */

export const DESIGN_REF_W = 2048
export const DESIGN_REF_H = 1152

/** Logical field aspect — matches layered sky + `field1` / `field2` art. */
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

/**
 * HUD power strip aligned to the field-layer “digital board” (`field` art).
 * Width is a fraction of logical canvas; shear scales with strip width so tilt stays
 * consistent when the bar is resized. With sprites, placement tracks the statue.
 */
export const POWER_FIELD_BOARD_WIDTH_FR = 0.34
/** Board width ÷ height (long thin scoreboard strip; ~15–18:1 in reference art). */
export const POWER_FIELD_BOARD_ASPECT = 17
/** Fallback center when `spriteLayout` is not ready yet (right-field / Ichiro side). */
export const POWER_FIELD_BOARD_CENTER_X_FR = 0.73
/** Fallback vertical placement vs canvas height. */
export const POWER_FIELD_BOARD_CENTER_Y_FR = 0.395
/**
 * Left-up tilt: extra Y (px) at the right edge per unit width — matches ~23px / ~337px
 * in reference grabs (shearPx = barW × this).
 */
export const POWER_FIELD_BOARD_SHEAR_RISE_PER_WIDTH_FR = 0.068
/** Horizontal anchor along statue opaque crop when sprites are loaded (0 = left, 1 = right). */
export const POWER_FIELD_BOARD_STATUE_REL_CX_FR = 0.5
/** Design px gap from statue sprite top to bottom of sheared strip (above Ichiro). */
export const POWER_FIELD_BOARD_GAP_ABOVE_STATUE_TOP_DESIGN = 16

/**
 * Middle carnival wheel only (`TARGET_RING_POINTS[1]` = 51): `public/assets/moose.webp`.
 * Anchor is the red circle center in normalized texture space; radius fraction is
 * circle radius ÷ naturalWidth so uniform scale keeps the on-screen red circle
 * matching the disc `targetR` (same as the filled-peg placeholders on other rows).
 */
export const MOOSE_TARGET_TEX_ANCHOR_X_FR = 2251 / 2732
export const MOOSE_TARGET_TEX_ANCHOR_Y_FR = 639 / 2048
/** Red circle radius as a fraction of sprite natural width (247.5px @ 2732×2048 source). */
export const MOOSE_TARGET_TEX_RADIUS_FR_OF_NAT_W = 247.5 / 2732

/**
 * Middle ring salmon targets (`public/assets/salmon/salmon1.webp` … `salmon4.webp`, 2048×2732).
 * Anchor = center of the round **sign** the salmon holds (hittable zone matches disc peg).
 * Tune if art shifts; keep all four sprites aligned to the same sign layout for one scale.
 */
export const SALMON_TARGET_TEX_ANCHOR_X_FR = 1024 / 2048
export const SALMON_TARGET_TEX_ANCHOR_Y_FR = 620 / 2732
/** Sign radius ÷ natural width — match on-screen radius to `targetR` like {@link MOOSE_TARGET_TEX_RADIUS_FR_OF_NAT_W}. */
export const SALMON_TARGET_TEX_RADIUS_FR_OF_NAT_W = 200 / 2048

/**
 * Front ring hydroplanes (`public/assets/hydroplanes/{silver,green,red,yellow}.webp`, 2732×2048).
 * Anchor = hull center / hit disc; tune to match art.
 */
export const HYDRO_PLANE_TEX_ANCHOR_X_FR = 1366 / 2732
export const HYDRO_PLANE_TEX_ANCHOR_Y_FR = 1040 / 2048
/** Hull hit radius ÷ natural width — scales sprite so disc `targetR` matches gameplay. */
export const HYDRO_PLANE_TEX_RADIUS_FR_OF_NAT_W = 210 / 2732

/**
 * Environmental hydro race (Mariners Hydro Challenge): horizontal pass through the field1
 * seating band — above the infield play area, below drifting clouds. Fractions of logical canvas height.
 */
export const HYDRO_RACE_BAND_Y_MIN_FR = 0.248
export const HYDRO_RACE_BAND_Y_MAX_FR = 0.488

/**
 * Salmon run (51 pt): lower-mid lane along field edge / base of stands — below hydro band.
 */
export const SALMON_RUN_BAND_Y_MIN_FR = 0.528
export const SALMON_RUN_BAND_Y_MAX_FR = 0.678
