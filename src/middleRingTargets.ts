/**
 * Middle carnival wheel — **rim salmon/moose layout** kept for reference; live 51 pt salmon
 * use {@link ./salmonRunTargets} (GameCanvas assigns zero middle-ring pegs).
 */

const TAU = Math.PI * 2

/** Peg count for legacy rim layout (not used when middle row has zero pegs). */
export const MIDDLE_RING_SLOT_COUNT = 10

export type MiddleRingArtKind =
  | 'moose'
  | 'salmon1'
  | 'salmon2'
  | 'salmon3'
  | 'salmon4'

type SalmonLeadId = 1 | 2 | 3

/** Permutations of salmon 1–3 (salmon4 is always fourth in each block of five). */
const SALMON_LEAD_PERMUTATIONS: readonly (readonly [SalmonLeadId, SalmonLeadId, SalmonLeadId])[] =
  [
    [1, 2, 3],
    [1, 3, 2],
    [2, 1, 3],
    [2, 3, 1],
    [3, 1, 2],
    [3, 2, 1],
  ]

function salmonTripletForBlock(
  blockIndex: number
): readonly [SalmonLeadId, SalmonLeadId, SalmonLeadId] {
  return SALMON_LEAD_PERMUTATIONS[blockIndex % SALMON_LEAD_PERMUTATIONS.length]
}

/**
 * Slot layout: `[moose, ?, ?, ?, salmon4]` ×2 around the wheel — `?` is a permutation of
 * salmon1–3 (varies by block); salmon4 is always last before the next moose.
 */
export function middleRingArtKind(slotIndex: number): MiddleRingArtKind {
  const n = MIDDLE_RING_SLOT_COUNT
  if (slotIndex < 0 || slotIndex >= n) return 'moose'
  const pos = slotIndex % 5
  const block = Math.floor(slotIndex / 5)
  if (pos === 0) return 'moose'
  if (pos === 4) return 'salmon4'
  const triplet = salmonTripletForBlock(block)
  const id = triplet[pos - 1]
  return (`salmon${id}` as MiddleRingArtKind)
}

/**
 * Uneven angular spacing so clusters can sit tight or stretch — still partitions the full turn.
 * Deterministic for stable gameplay / save compatibility.
 */
export type MiddleRingTargetImages = {
  moose: HTMLImageElement | null
  salmon1: HTMLImageElement | null
  salmon2: HTMLImageElement | null
  salmon3: HTMLImageElement | null
  salmon4: HTMLImageElement | null
}

/** Salmon art + hit circle vs base peg / moose (1 = same size). */
export const SALMON_TARGET_SCALE = 0.75

export function makeMiddleRingClusteredSlotAngles(): number[] {
  const n = MIDDLE_RING_SLOT_COUNT
  /** Positive weights; larger gap ⇒ more arc before next peg. */
  const raw = [
    1.15, 0.62, 0.88, 0.55, 1.05, 1.08, 0.58, 0.92, 0.52, 1.12,
  ]
  const sum = raw.reduce((a, b) => a + b, 0)
  const angles: number[] = []
  let acc = 0
  for (let i = 0; i < n; i++) {
    angles.push(acc)
    acc += (raw[i] / sum) * TAU
  }
  return angles
}
