import { useState } from 'react'
import { useMeasure } from './useMeasure.ts'
import { Tooltip } from '../components/Tooltip.tsx'
import { compact, niceTicks, pct } from '../format.ts'

export interface Point { key: string; label: string; x: number; y: number; color?: string }

const PAD = { top: 16, right: 20, bottom: 38, left: 52 }

/**
 * Streaming demand (x) against ticket sell-through (y), one dot per market.
 * Single series, so no legend - the axis titles say what is plotted. Every dot
 * gets a 24px transparent hit area because an 8px dot is a pinpoint nobody hits.
 */
export function ScatterChart({ points, height = 300, xLabel, yLabel, yRefLine }: {
  points: Point[]; height?: number; xLabel: string; yLabel: string; yRefLine?: number
}) {
  const { ref, width } = useMeasure<HTMLDivElement>(560)
  const [hover, setHover] = useState<{ p: Point; x: number; y: number } | null>(null)

  if (points.length === 0) return <div className="empty">Needs both listener geography and box office data.</div>

  const xTicks = niceTicks(Math.max(...points.map((p) => p.x)))
  const xMax = xTicks.at(-1) || 1
  const yMax = Math.max(1, Math.max(...points.map((p) => p.y)))

  const innerW = Math.max(width - PAD.left - PAD.right, 10)
  const innerH = height - PAD.top - PAD.bottom
  const px = (v: number) => PAD.left + (v / xMax) * innerW
  const py = (v: number) => PAD.top + innerH - (v / yMax) * innerH

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img"
        aria-label={`Scatter plot: ${xLabel} against ${yLabel}`}>
        {niceTicks(yMax).map((t) => (
          <g key={`y${t}`}>
            <line x1={PAD.left} x2={width - PAD.right} y1={py(t)} y2={py(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.left - 8} y={py(t) + 4} textAnchor="end" fontSize={10} fill="var(--text-muted)">{pct(t, 0)}</text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={`x${t}`} x={px(t)} y={height - 20} textAnchor="middle" fontSize={10} fill="var(--text-muted)">{compact(t, 0)}</text>
        ))}

        {yRefLine != null ? (
          <>
            <line x1={PAD.left} x2={width - PAD.right} y1={py(yRefLine)} y2={py(yRefLine)}
              stroke="var(--axis)" strokeWidth={1} />
            <text x={width - PAD.right} y={py(yRefLine) - 5} textAnchor="end" fontSize={10} fill="var(--text-muted)">
              tour average {pct(yRefLine, 0)}
            </text>
          </>
        ) : null}

        {points.map((p) => (
          <g key={p.key}
            onPointerEnter={(e) => {
              const r = ref.current?.getBoundingClientRect()
              if (r) setHover({ p, x: e.clientX - r.left, y: e.clientY - r.top })
            }}
            onPointerLeave={() => setHover(null)}>
            <circle cx={px(p.x)} cy={py(p.y)} r={12} fill="transparent" />
            <circle cx={px(p.x)} cy={py(p.y)} r={5} fill={p.color ?? 'var(--series-1)'} stroke="var(--surface-1)" strokeWidth={2} />
          </g>
        ))}

        {/* Label only the extremes - a name on every dot is noise. A label near the
            right edge flips to the left of its dot rather than being clipped. */}
        {labelWorthy(points).map((p) => {
          const cx = px(p.x)
          const estWidth = p.label.length * 6.2
          const flip = cx + 10 + estWidth > width - PAD.right
          return (
            <text key={`l${p.key}`} x={cx + (flip ? -10 : 10)} y={py(p.y) + 4} fontSize={11}
              textAnchor={flip ? 'end' : 'start'} fill="var(--text-secondary)">{p.label}</text>
          )
        })}

        <text x={PAD.left + innerW / 2} y={height - 4} textAnchor="middle" fontSize={11} fill="var(--text-muted)">{xLabel}</text>
        <text x={12} y={PAD.top + innerH / 2} fontSize={11} fill="var(--text-muted)" textAnchor="middle"
          transform={`rotate(-90 12 ${PAD.top + innerH / 2})`}>{yLabel}</text>
      </svg>

      {hover ? (
        <Tooltip x={hover.x} y={hover.y} containerWidth={width} title={hover.p.label}
          rows={[
            { label: xLabel, value: compact(hover.p.x), color: hover.p.color ?? 'var(--series-1)' },
            { label: yLabel, value: pct(hover.p.y) },
          ]} />
      ) : null}
    </div>
  )
}

function labelWorthy(points: Point[]): Point[] {
  const byX = [...points].sort((a, b) => b.x - a.x).slice(0, 2)
  const byY = [...points].sort((a, b) => b.y - a.y).slice(0, 1)
  const worst = [...points].sort((a, b) => a.y - b.y).slice(0, 1)
  const seen = new Set<string>()
  return [...byX, ...byY, ...worst].filter((p) => !seen.has(p.key) && seen.add(p.key))
}
