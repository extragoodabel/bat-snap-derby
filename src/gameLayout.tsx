import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react'

export type GameLayoutKind = 'desktop' | 'mobile-landscape' | 'mobile-portrait'

export type GameLayout = {
  kind: GameLayoutKind
  isMobile: boolean
  isPortraitMobile: boolean
  isLandscape: boolean
}

const DESKTOP_FALLBACK: GameLayout = {
  kind: 'desktop',
  isMobile: false,
  isPortraitMobile: false,
  isLandscape: true,
}

/**
 * Handheld-focused layout: phones and small phabletes. Excludes typical tablets
 * (e.g. iPad portrait min edge > 720) so desktop-style chrome can remain there.
 */
export function computeGameLayout(innerWidth: number, innerHeight: number): GameLayout {
  const w = innerWidth
  const h = innerHeight
  const min = Math.min(w, h)
  const max = Math.max(w, h)
  const isLandscape = w >= h

  const isMobile =
    min <= 520 ||
    (min <= 600 && max <= 920) ||
    (min <= 680 && max <= 960)

  if (!isMobile) {
    return { kind: 'desktop', isMobile: false, isPortraitMobile: false, isLandscape }
  }
  if (!isLandscape) {
    return {
      kind: 'mobile-portrait',
      isMobile: true,
      isPortraitMobile: true,
      isLandscape: false,
    }
  }
  return {
    kind: 'mobile-landscape',
    isMobile: true,
    isPortraitMobile: false,
    isLandscape: true,
  }
}

export function readGameLayout(): GameLayout {
  if (typeof window === 'undefined') return DESKTOP_FALLBACK
  return computeGameLayout(window.innerWidth, window.innerHeight)
}

const GameLayoutContext = createContext<GameLayout>(DESKTOP_FALLBACK)

export function GameLayoutProvider({ children }: { children: ReactNode }) {
  const [layout, setLayout] = useState<GameLayout>(() =>
    typeof window === 'undefined' ? DESKTOP_FALLBACK : readGameLayout()
  )

  useEffect(() => {
    const sync = () => setLayout(readGameLayout())
    sync()
    window.addEventListener('resize', sync)
    window.addEventListener('orientationchange', sync)
    return () => {
      window.removeEventListener('resize', sync)
      window.removeEventListener('orientationchange', sync)
    }
  }, [])

  useLayoutEffect(() => {
    document.documentElement.dataset.gameLayout = layout.kind
    return () => {
      delete document.documentElement.dataset.gameLayout
    }
  }, [layout.kind])

  return (
    <GameLayoutContext.Provider value={layout}>{children}</GameLayoutContext.Provider>
  )
}

export function useGameLayout(): GameLayout {
  return useContext(GameLayoutContext)
}
