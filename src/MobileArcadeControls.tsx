import { useCallback, useRef } from 'react'

export type MobileControlsVariant = 'landscape' | 'portrait'

type MobileArcadeControlsProps = {
  variant: MobileControlsVariant
  /** Finger down on joystick base (start / continue charge). */
  onJoystickActiveChange: (active: boolean) => void
  /** Normalized stick offset from knob center, roughly −1…1 (clamped). */
  onJoystickOffset: (x: number, y: number) => void
  rapidFireEnabled: boolean
  onRapidFireChange: (enabled: boolean) => void
}

const KNOB_MAX_PX = 26

export function MobileArcadeControls({
  variant,
  onJoystickActiveChange,
  onJoystickOffset,
  rapidFireEnabled,
  onRapidFireChange,
}: MobileArcadeControlsProps) {
  const baseRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const setStickPx = useCallback(
    (dx: number, dy: number) => {
      const el = stickRef.current
      if (!el) return
      const mx = Math.max(-KNOB_MAX_PX, Math.min(KNOB_MAX_PX, dx))
      const my = Math.max(-KNOB_MAX_PX, Math.min(KNOB_MAX_PX, dy))
      el.style.transform = `translate(calc(-50% + ${mx}px), calc(-50% + ${my}px))`
      const nx = mx / KNOB_MAX_PX
      const ny = my / KNOB_MAX_PX
      onJoystickOffset(nx, ny)
    },
    [onJoystickOffset]
  )

  const resetStickVisual = useCallback(() => {
    const el = stickRef.current
    if (el) el.style.transform = 'translate(-50%, -50%)'
    onJoystickOffset(0, 0)
  }, [onJoystickOffset])

  const onJoystickPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const base = baseRef.current
      if (!base) return
      base.setPointerCapture(e.pointerId)
      draggingRef.current = true
      const r = base.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      setStickPx(e.clientX - cx, e.clientY - cy)
      onJoystickActiveChange(true)
    },
    [onJoystickActiveChange, setStickPx]
  )

  const onJoystickPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return
      const base = baseRef.current
      if (!base) return
      const r = base.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      setStickPx(e.clientX - cx, e.clientY - cy)
    },
    [setStickPx]
  )

  const finishJoystick = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return
      draggingRef.current = false
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      onJoystickActiveChange(false)
      resetStickVisual()
    },
    [onJoystickActiveChange, resetStickVisual]
  )

  return (
    <div
      className={`mobile-arcade-controls mobile-arcade-controls--${variant}`}
      data-variant={variant}
    >
      <div className="mobile-arcade-controls__main">
        <div className="mobile-arcade-controls__cluster mobile-arcade-controls__cluster--left">
          <div
            ref={baseRef}
            className="mobile-joystick"
            onPointerDown={onJoystickPointerDown}
            onPointerMove={onJoystickPointerMove}
            onPointerUp={finishJoystick}
            onPointerCancel={finishJoystick}
            onLostPointerCapture={finishJoystick}
          >
            <div className="mobile-joystick__bezel" />
            <div ref={stickRef} className="mobile-joystick__knob" />
          </div>
          <span className="mobile-joystick__caption">Swing bat</span>
        </div>

        <div className="mobile-arcade-controls__cluster mobile-arcade-controls__cluster--right">
          <label className="mobile-rapid">
            <input
              type="checkbox"
              checked={rapidFireEnabled}
              onChange={(ev) => onRapidFireChange(ev.target.checked)}
            />
            <span>Rapid demo swings</span>
          </label>
        </div>
      </div>

      <p className="mobile-arcade-controls__howto">
        Drag the pad to pull the bat back, then <strong>lift your finger</strong> to swing
        (same as mouse on desktop).
      </p>
    </div>
  )
}
