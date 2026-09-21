/** 12-point trend line for a stat tile. Decorative scale, no axis - the tile carries the number. */
export function Sparkline({ values, color = 'var(--series-1)', width = 76, height = 22 }: {
  values: Array<number | null>; color?: string; width?: number; height?: number
}) {
  const points = values.filter((v): v is number => v != null)
  if (points.length < 2) return null

  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const step = width / (points.length - 1)
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${i * step},${height - ((v - min) / span) * (height - 4) - 2}`).join('')
  const lastY = height - ((points.at(-1)! - min) / span) * (height - 4) - 2

  return (
    <svg width={width} height={height} aria-hidden="true" style={{ flex: 'none' }}>
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.55} />
      <circle cx={width} cy={lastY} r={2.5} fill={color} />
    </svg>
  )
}
