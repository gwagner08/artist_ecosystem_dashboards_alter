import { useEffect, useState } from 'react'

/**
 * The Firebird wordmark, resolved once rather than repaired on error.
 *
 * The previous version set `src` from a React prop and walked fallbacks in an
 * onError handler. That works on first paint and then breaks: every re-render
 * re-applies the prop's URL, onError fires again, the exhausted fallback list gives
 * up, and the logo hides itself permanently.
 *
 * So probe the candidates once, keep the winner in state, and let re-renders be
 * harmless. Per brand guidelines the mark is never redrawn - if none of the
 * candidates exist the slot simply stays empty.
 */
const LIGHT_CANDIDATES = [
  '/brand/firebird-wordmark.svg',
  '/brand/firebird-wordmark.png',
  '/firebird-wordmark.svg',
  '/firebird-wordmark.png',
]

// The official white wordmark, when supplied, is preferred on the black theme.
const DARK_CANDIDATES = [
  '/brand/firebird-wordmark-white.svg',
  '/brand/firebird-wordmark-white.png',
  ...LIGHT_CANDIDATES,
]

function loads(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(true)
    img.onerror = () => resolve(false)
    img.src = url
  })
}

export function BrandLogo({ dark }: { dark: boolean }) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      for (const candidate of dark ? DARK_CANDIDATES : LIGHT_CANDIDATES) {
        if (await loads(candidate)) {
          if (!cancelled) setSrc(candidate)
          return
        }
        if (cancelled) return
      }
      if (!cancelled) setSrc(null)
    })()
    return () => { cancelled = true }
  }, [dark])

  if (!src) return null

  // A white wordmark needs no lift; the red one gets a small one on black.
  const isWhiteMark = src.includes('-white')
  return (
    <img
      className="brand-logo"
      src={src}
      alt="Firebird"
      data-white={isWhiteMark ? 'true' : 'false'}
    />
  )
}
