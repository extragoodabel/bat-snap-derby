/**
 * Lightweight encouragement to use landscape on phones (not a full-screen blocker).
 */
export function RotatePlayHint() {
  return (
    <div className="rotate-play-hint" role="status">
      <span className="rotate-play-hint__glyph" aria-hidden>
        ⟲
      </span>
      <span className="rotate-play-hint__text">Rotate for best play</span>
    </div>
  )
}
