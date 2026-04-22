/**
 * Hydro plane WebP assets (environmental race + legacy rim wheel in
 * {@link ./hydroRingTargets.legacy}).
 */

export type HydroRingImages = {
  silver: HTMLImageElement | null
  green: HTMLImageElement | null
  red: HTMLImageElement | null
  yellow: HTMLImageElement | null
}

export {
  FRONT_RING_SLOT_COUNT,
  hydroPlaneOffsetRad,
  makeFrontRingClusteredSlotAngles,
  rimSlotWorldAngle,
} from './hydroRingTargets.legacy'
