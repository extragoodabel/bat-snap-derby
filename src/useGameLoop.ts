import { useEffect, useRef } from 'react'

const MAX_DT = 1 / 30

/**
 * Runs `onFrame(dtSeconds)` each animation frame. `dt` is clamped for stability.
 */
export function useGameLoop(onFrame: (dt: number) => void, active = true): void {
  const onFrameRef = useRef(onFrame)

  useEffect(() => {
    onFrameRef.current = onFrame
  }, [onFrame])

  useEffect(() => {
    if (!active) return

    let raf = 0
    let last = performance.now()

    const tick = (now: number) => {
      const dt = Math.min(MAX_DT, (now - last) / 1000)
      last = now
      onFrameRef.current(dt)
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active])
}
