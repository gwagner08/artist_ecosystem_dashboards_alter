import { useState, useMemo } from 'react'
import { useMeasure } from './useMeasure.ts'
import { Tooltip, Legend } from '../components/Tooltip.tsx'
import { compact, shortDate, niceTicks } from '../format.ts'

export interface Series { key: string; label: string; color: string; points: Array<{ date: string; value: number | null }> }

const PAD = { top: 14, right: 62, bottom: 26, left: 46 }

/**
 * Multi-series line chart. 2px strokes, >=8px end markers with a 2px surface ring,
 * hairline gridlines, one crosshair tooltip listing every series at the hovered X.
 * Never a second y-axis - callers index to a common base or use two charts.
 */
export function LineChart({ series, height = 240, valueFormat = compact, showEndLabels = true }: {
  series: Series[]; height?: number; valueFormat?: (n: number | null) => string; showEndLabels?: boolean
}) {
  const { ref, width } = useMeasure<HTMLDivElement>(640)
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null)

  const dates = useMemo(() => {
    const all = new Set<string>()
    for (const s of series) for (const p of s.points) all.add(p.date)
    return [...all].sort()
  }, [series])

  const max = useMemo(() => {
    let m = 0
    for (const s of series) for (const p of s.points) if (p.value != null && p.value > m) m = p.value
    return m
  }, [series])

  if (dates.length === 0 || max === 0) return <div className="empty">No data in this range.</div>

  const innerW = Math.max(width - PAD.left - PAD.right, 10)
  const innerH = height - PAD.top - PAD.bottom
  const ticks = niceTicks(max)
  const yMax = ticks.at(-1) || max

  const xAt = (i: number) => PAD.left + (dates.length === 1 ? innerW / 2 : (i / (dates.length - 1)) * innerW)
  const yAt = (v: number) => PAD.top + innerH - (v / yMax) * innerH

  const byDate = series.map((s) => ({ s, map: new Map(s.points.map((p) => [p.date, p.value])) }))

  // Endpoint of each series, and which of those endpoints can carry a direct label.
  const ends = byDate.map(({ s, map }) => {
    const i = dates.reduce((acc, d, idx) => (map.get(d) != null ? idx : acc), -1)
    return i < 0 ? null : { key: s.key, color: s.color, i, value: map.get(dates[i]!)! }
  }).filter((e): e is NonNullable<typeof e> => e !== null)

  // When lines converge at the right edge, nudging labels apart detaches them from
  // their lines and reads as noise - so drop the colliders and let the legend and
  // tooltip carry those series instead.
  const labelled = new Set<string>()
  if (showEndLabels && series.length <= 4) {
    const taken: number[] = []
    for (const e of [...ends].sort((a, b) => b.value - a.value)) {
      const y = yAt(e.value)
      if (taken.every((t) => Math.abs(t - y) >= 13)) { labelled.add(e.key); taken.push(y) }
    }
  }

  const onMove = (e: React.PointerEvent) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    const rel = e.clientX - rect.left
    const ratio = (rel - PAD.left) / innerW
    const i = Math.max(0, Math.min(dates.length - 1, Math.round(ratio * (dates.length - 1))))
    setHover({ i, x: xAt(i), y: e.clientY - rect.top })
  }

  const hoveredDate = hover ? dates[hover.i]! : null

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />
      <svg
        width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img"
        aria-label={`Line chart: ${series.map((s) => s.label).join(', ')}`}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ touchAction: 'none' }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={yAt(t)} y2={yAt(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.left - 8} y={yAt(t) + 4} textAnchor="end" fontSize={10} fill="var(--text-muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {compact(t, 0)}
            </text>
          </g>
        ))}

        {[0, Math.floor(dates.length / 2), dates.length - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) => (
          <text key={i} x={xAt(i)} y={height - 8} textAnchor={i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle'}
            fontSize={10} fill="var(--text-muted)">{shortDate(dates[i]!)}</text>
        ))}

        {hoveredDate ? <line x1={xAt(hover!.i)} x2={xAt(hover!.i)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--axis)" strokeWidth={1} /> : null}

        {byDate.map(({ s, map }) => {
          // Break the path on gaps so a missing day is a hole, not a straight line through it.
          const segments: string[] = []
          let current = ''
          dates.forEach((d, i) => {
            const v = map.get(d)
            if (v == null) { if (current) segments.push(current); current = ''; return }
            current += `${current ? 'L' : 'M'}${xAt(i)},${yAt(v)}`
          })
          if (current) segments.push(current)

          const end = ends.find((e) => e.key === s.key)

          return (
            <g key={s.key}>
              {segments.map((d, i) => (
                <path key={i} d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              ))}
              {end ? (
                <>
                  <circle cx={xAt(end.i)} cy={yAt(end.value)} r={4} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} />
                  {labelled.has(s.key) ? (
                    <text x={xAt(end.i) + 9} y={yAt(end.value) + 4} fontSize={11} fontWeight={600} fill="var(--text-secondary)">
                      {valueFormat(end.value)}
                    </text>
                  ) : null}
                </>
              ) : null}
            </g>
          )
        })}

        {hoveredDate
          ? byDate.map(({ s, map }) => {
              const v = map.get(hoveredDate)
              return v == null ? null : (
                <circle key={s.key} cx={xAt(hover!.i)} cy={yAt(v)} r={4} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} />
              )
            })
          : null}
      </svg>

      {hoveredDate ? (
        <Tooltip
          x={hover!.x} y={hover!.y} containerWidth={width}
          title={new Date(`${hoveredDate}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
          rows={byDate.map(({ s, map }) => ({ label: s.label, value: valueFormat(map.get(hoveredDate) ?? null), color: s.color }))}
        />
      ) : null}
    </div>
  )
}
