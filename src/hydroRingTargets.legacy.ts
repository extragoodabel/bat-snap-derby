/**
 * Legacy rim-mounted hydro system (24 pt front wheel) — kept for reference / possible reuse.
 * Live gameplay uses {@link ./hydroRaceTargets} only; GameCanvas assigns zero front-ring pegs so
 * this wheel is not rendered (see `RING_TARGET_COUNTS` / `createDiscRingsForLayout`).
 */

const TAU = Math.PI * 2

export const FRONT_RING_SLOT_COUNT = 7

/** Uneven rim spacing: tight packs and longer gaps so boats don’t read as a clock dial. */
export function makeFrontRingClusteredSlotAngles(): number[] {
  const n = FRONT_RING_SLOT_COUNT
  const raw = [1.18, 0.52, 0.95, 0.48, 1.12, 0.58, 1.05]
  const sum = raw.reduce((a, b) => a + b, 0)
  const angles: number[] = []
  let acc = 0
  for (let i = 0; i < n; i++) {
    angles.push(acc)
    acc += (raw[i] / sum) * TAU
  }
  return angles
}

/**
 * Small angular “lane” wobble (rad). Per-slot motion **speed** drifts slowly via `speedMul`;
 * sprite livery stays fixed until a slot re-arms (legacy wheel behavior).
 */
export function hydroPlaneOffsetRad(slotIndex: number, simTimeSec: number): number {
  const speedMul =
    0.78 +
    0.32 * Math.sin(simTimeSec * 0.14 + slotIndex * 0.67) +
    0.12 * Math.sin(simTimeSec * 0.05 + slotIndex * 0.31)
  const t = simTimeSec * speedMul
  const s1 = Math.sin(t * (0.92 + slotIndex * 0.14) + slotIndex * 2.1)
  const s2 = Math.sin(t * (1.55 + slotIndex * 0.11) + slotIndex * 0.85)
  const s3 = Math.sin(t * 0.31 + slotIndex * 0.4)
  return 0.02 * s1 + 0.017 * s2 + 0.008 * s3
}

export function rimSlotWorldAngle(
  ring: { rotation: number; slotAngles: number[] },
  ringIdx: number,
  slotIdx: number,
  simTime: number
): number {
  const base = ring.rotation + ring.slotAngles[slotIdx]
  if (ringIdx !== 0) return base
  return base + hydroPlaneOffsetRad(slotIdx, simTime)
}
