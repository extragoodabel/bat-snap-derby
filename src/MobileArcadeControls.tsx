import { useCallback, useRef, useState } from 'react'

export type MobileControlsVariant = 'landscape' | 'portrait'

type MobileArcadeControlsProps = {
  variant: MobileControlsVariant
  /** Finger down on bat trigger (start / continue charge). */
  onBatTriggerActiveChange: (active: boolean) => void
  /** Normalized pullback 0…1 along the 45° rightward load arc (maps to sim power + θ). */
  onBatPull01Change: (u: number) => void
}

/** Same angular window as GameCanvas `MOBILE_PULLBACK_ARC_RAD` (45° toward the plate). */
const PULL_ANGLE_MIN = -Math.PI / 2
const PULL_ANGLE_MAX = -Math.PI / 2 + Math.PI / 4

function pull01FromPointer(
  pivotCx: number,
  pivotCy: number,
  clientX: number,
  clientY: number
): number {
  const ang = Math.atan2(clientY - pivotCy, clientX - pivotCx)
  const a = Math.max(PULL_ANGLE_MIN, Math.min(PULL_ANGLE_MAX, ang))
  return (a - PULL_ANGLE_MIN) / (PULL_ANGLE_MAX - PULL_ANGLE_MIN)
}

/** Visual rotation mirrors the 45° sim load arc (rest → full pullback). */
const BAT_REST_DEG = -12
const BAT_LOAD_EXTRA_DEG = 38

export function MobileArcadeControls({
  variant,
  onBatTriggerActiveChange,
  onBatPull01Change,
}: MobileArcadeControlsProps) {
  const zoneRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const [pull01Display, setPull01Display] = useState(0)

  const updatePull = useCallback(
    (clientX: number, clientY: number) => {
      const z = zoneRef.current
      if (!z) return
      const r = z.getBoundingClientRect()
      const cx = r.left + r.width * 0.5
      const cy = r.bottom - Math.min(18, r.height * 0.12)
      const u = pull01FromPointer(cx, cy, clientX, clientY)
      setPull01Display(u)
      onBatPull01Change(u)
    },
    [onBatPull01Change]
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const z = zoneRef.current
      if (!z) return
      z.setPointerCapture(e.pointerId)
      draggingRef.current = true
      onBatTriggerActiveChange(true)
      setPull01Display(0)
      updatePull(e.clientX, e.clientY)
    },
    [onBatTriggerActiveChange, updatePull]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return
      updatePull(e.clientX, e.clientY)
    },
    [updatePull]
  )

  const finish = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return
      draggingRef.current = false
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      onBatTriggerActiveChange(false)
      setPull01Display(0)
    },
    [onBatTriggerActiveChange]
  )

  return (
    <div
      className={`mobile-bat-trigger-panel mobile-bat-trigger-panel--${variant}`}
      data-variant={variant}
    >
      <div
        ref={zoneRef}
        className="mobile-bat-trigger"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
      >
        <div className="mobile-bat-trigger__rail" aria-hidden="true">
          <svg
            className="mobile-bat-trigger__arc-svg"
            viewBox="0 0 120 72"
            preserveAspectRatio="xMidYMax meet"
          >
            <path
              d="M 12 60 A 52 52 0 0 1 92 22"
              fill="none"
              stroke="rgba(196, 206, 212, 0.35)"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <div
          className="mobile-bat-trigger__bat-wrap"
          style={{
            transform: `rotate(${BAT_REST_DEG + pull01Display * BAT_LOAD_EXTRA_DEG}deg)`,
          }}
        >
          <img
            className="mobile-bat-trigger__bat-img"
            src="/assets/bat.webp"
            alt=""
            draggable={false}
          />
          <div className="mobile-bat-trigger__grip-cap" aria-hidden="true" />
        </div>
        <span className="mobile-bat-trigger__slot-label">Pull to load</span>
      </div>

      <div className="mobile-bat-trigger__sticker" aria-hidden="true">
        <svg
          className="mobile-bat-trigger__sticker-arrow"
          viewBox="0 0 120 48"
          role="img"
        >
          <path
            d="M 14 38 L 14 18 L 44 18"
            fill="none"
            stroke="rgba(255, 248, 220, 0.9)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M 38 12 L 52 18 L 38 24"
            fill="none"
            stroke="rgba(255, 248, 220, 0.9)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div className="mobile-bat-trigger__sticker-lines">
          <span>Pull back</span>
          <span>Release to swing</span>
        </div>
      </div>
    </div>
  )
}
