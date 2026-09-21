import { useEffect, useRef, useState } from 'react'

/**
 * Tracks a container's width via ResizeObserver so SVG charts can lay out against
 * real pixels. Measuring inside a ref callback re-fires on every render; this does not.
 */
export function useMeasure<T extends HTMLElement>(initial = 560) {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(initial)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const w = el.clientWidth
      if (w > 0) setWidth((prev) => (Math.abs(prev - w) > 0.5 ? w : prev))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return { ref, width }
}
