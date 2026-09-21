import { useState } from 'react'
import { useMeasure } from './useMeasure.ts'
import { Tooltip } from '../components/Tooltip.tsx'
import { pct } from '../format.ts'

export interface Bar { key: string; label: string; sublabel?: string; value: number; color?: string; note?: string }

const ROW_H = 30
const BAR_H = 18   // <= 24px cap; the leftover band height is deliberate air
const LABEL_W = 168

/**
 * Horizontal bars for magnitude across named categories. 4px rounded data-end,
 * square at the baseline. Each bar carries its own tooltip; the mark is the hit
 * target and its hit area is the full row, not the painted pixels.
 */
export function BarChart({ bars, max, valueFormat = pct, axisLabel }: {
  bars: Bar[]; max?: number; valueFormat?: (n: number) => string; axisLabel?: string
}) {
  const { ref, width } = useMeasure<HTMLDivElement>(560)
  const [hover, setHover] = useState<{ bar: Bar; x: number; y: number } | null>(null)

  if (bars.length === 0) return <div className="empty">No markets in this range.</div>

  const top = Math.max(max ?? Math.max(...bars.map((b) => b.value)), 0.0001)
  const height = bars.length * ROW_H + 22
  const innerW = Math.max(width - LABEL_W - 58, 20)
  const w = (v: number) => Math.max((Math.max(v, 0) / top) * innerW, 2)

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img"
        aria-label={axisLabel ?? 'Bar chart'}>
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={LABEL_W + innerW * f} x2={LABEL_W + innerW * f} y1={0} y2={bars.length * ROW_H}
            stroke="var(--grid)" strokeWidth={1} />
        ))}

        {bars.map((b, i) => {
          const y = i * ROW_H
          const barY = y + (ROW_H - BAR_H) / 2
          const bw = w(b.value)
          const color = b.color ?? 'var(--series-1)'
          return (
            <g key={b.key}
              onPointerMove={(e) => {
                const r = ref.current?.getBoundingClientRect()
                if (r) setHover({ bar: b, x: e.clientX - r.left, y: e.clientY - r.top })
              }}
              onPointerLeave={() => setHover(null)} style={{ cursor: 'default' }}>
              {/* Hit target spans the whole row so a short bar is still easy to hover. */}
              <rect x={0} y={y} width={width} height={ROW_H} fill="transparent" />
              <text x={0} y={y + ROW_H / 2 + 4} fontSize={12} fill="var(--text-primary)">
                {b.label.length > 20 ? `${b.label.slice(0, 19)}…` : b.label}
              </text>
              {b.sublabel ? (
                <text x={LABEL_W - 10} y={y + ROW_H / 2 + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)"
                  style={{ fontVariantNumeric: 'tabular-nums' }}>{b.sublabel}</text>
              ) : null}
              {/* Square at the baseline, 4px rounded at the data end. */}
              <path d={roundedEnd(LABEL_W, barY, bw, BAR_H, 4)} fill={color} />
              <text x={LABEL_W + bw + 8} y={barY + BAR_H / 2 + 4} fontSize={11} fontWeight={600} fill="var(--text-secondary)"
                style={{ fontVariantNumeric: 'tabular-nums' }}>{valueFormat(b.value)}</text>
            </g>
          )
        })}

        {axisLabel ? (
          <text x={LABEL_W} y={height - 4} fontSize={10} fill="var(--text-muted)">{axisLabel}</text>
        ) : null}
      </svg>

      {hover ? (
        <Tooltip x={hover.x} y={hover.y} containerWidth={width} title={hover.bar.label}
          rows={[
            { label: 'Value', value: valueFormat(hover.bar.value), color: hover.bar.color ?? 'var(--series-1)' },
            ...(hover.bar.sublabel ? [{ label: 'Detail', value: hover.bar.sublabel }] : []),
            ...(hover.bar.note ? [{ label: 'Note', value: hover.bar.note }] : []),
          ]} />
      ) : null}
    </div>
  )
}

/** Path with rounded corners on the right edge only. */
function roundedEnd(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2)
  return `M${x},${y} H${x + w - rr} A${rr},${rr} 0 0 1 ${x + w},${y + rr} V${y + h - rr} A${rr},${rr} 0 0 1 ${x + w - rr},${y + h} H${x} Z`
}
