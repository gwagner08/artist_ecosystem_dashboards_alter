import { useState } from 'react'
import type { CreatorBreakdownRow } from '@shared/types.ts'
import { Tooltip } from '../components/Tooltip.tsx'
import { useMeasure } from './useMeasure.ts'
import { full, pct } from '../format.ts'

/*
 * Gender is two categories, so it takes the two poles of the brand palette - red and
 * ink - rather than a slot from the categorical ramp. They separate in greyscale and
 * under any colour-vision deficiency, which a pair of hues would not guarantee.
 */
const MALE = 'var(--red)'
const FEMALE = 'var(--neutral-mark)'

const AGE_ORDER = ['13-17', '18-24', '25-34', '35-44', '45-64', '65+']

export interface GenderSplit { male: number; female: number; other: number }

/** Sum the age|gender rows down to a gender split. */
export function genderSplit(rows: CreatorBreakdownRow[]): GenderSplit {
  const out: GenderSplit = { male: 0, female: 0, other: 0 }
  for (const r of rows) {
    const g = (r.gender ?? '').toLowerCase()
    if (g.startsWith('m')) out.male += r.count
    else if (g.startsWith('f')) out.female += r.count
    else out.other += r.count
  }
  return out
}

/**
 * Two-segment donut for the gender split.
 *
 * A donut earns its place only for a part-to-whole with very few parts; the labels
 * sit inside so the reader never matches colour to a legend.
 */
export function GenderDonut({ split, size = 190 }: { split: GenderSplit; size?: number }) {
  const total = split.male + split.female + split.other
  if (total === 0) return <div className="empty">No gender data.</div>

  const r = size / 2 - 16
  const c = size / 2
  const stroke = 26
  const circumference = 2 * Math.PI * r

  const segments = [
    { key: 'Male', value: split.male, color: MALE },
    { key: 'Female', value: split.female, color: FEMALE },
    ...(split.other > 0 ? [{ key: 'Unknown', value: split.other, color: 'var(--text-muted)' }] : []),
  ].filter((s) => s.value > 0)

  let offset = 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
      <svg width={size} height={size} role="img"
        aria-label={`Gender split: ${segments.map((s) => `${s.key} ${pct(s.value / total, 1)}`).join(', ')}`}>
        <g transform={`rotate(-90 ${c} ${c})`}>
          {segments.map((s) => {
            const length = (s.value / total) * circumference
            // A 2px surface gap separates touching arcs, as with stacked bars.
            const dash = `${Math.max(length - 2, 0)} ${circumference - Math.max(length - 2, 0)}`
            const el = (
              <circle key={s.key} cx={c} cy={c} r={r} fill="none" stroke={s.color}
                strokeWidth={stroke} strokeDasharray={dash} strokeDashoffset={-offset} />
            )
            offset += length
            return el
          })}
        </g>
      </svg>

      {/* Values read beside a colour key rather than being coloured themselves. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {segments.map((s) => (
          <span key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="legend-swatch" style={{ background: s.color, width: 12, height: 12, borderRadius: 3 }} />
            <span style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 15 }}>
              {pct(s.value / total, 1)}
            </span>
            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{s.key}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * Age pyramid: one row per age bracket, the two genders mirrored about a shared
 * centre. Bars grow from that centre, so it is one axis read twice - not a dual axis.
 */
export function AgePyramid({ rows, height = 240 }: { rows: CreatorBreakdownRow[]; height?: number }) {
  const { ref, width } = useMeasure<HTMLDivElement>(520)
  const [hover, setHover] = useState<{ x: number; y: number; title: string; rows: Array<{ label: string; value: string; color?: string }> } | null>(null)

  const total = rows.reduce((a, r) => a + r.count, 0)
  if (total === 0) return <div className="empty">No age or gender data.</div>

  const brackets = AGE_ORDER.filter((age) => rows.some((r) => r.ageGroup === age))
  const extra = [...new Set(rows.map((r) => r.ageGroup).filter((a): a is string => Boolean(a)))]
    .filter((a) => !AGE_ORDER.includes(a))
  const order = [...brackets, ...extra]

  const shareOf = (age: string, gender: 'm' | 'f') =>
    rows.filter((r) => r.ageGroup === age && (r.gender ?? '').toLowerCase().startsWith(gender))
      .reduce((a, r) => a + r.count, 0) / total

  const countOf = (age: string, gender: 'm' | 'f') =>
    rows.filter((r) => r.ageGroup === age && (r.gender ?? '').toLowerCase().startsWith(gender))
      .reduce((a, r) => a + r.count, 0)

  const maxShare = Math.max(
    ...order.flatMap((age) => [shareOf(age, 'm'), shareOf(age, 'f')]),
    0.01,
  )

  const LABEL_W = 56
  const rowH = Math.max(22, Math.min(34, (height - 30) / Math.max(order.length, 1)))
  const barH = Math.min(18, rowH - 8)
  const innerW = Math.max(width - LABEL_W - 20, 60)
  const centre = LABEL_W + innerW / 2
  const halfW = innerW / 2
  const scale = (share: number) => (share / maxShare) * (halfW - 6)
  const chartH = order.length * rowH + 26

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div className="legend">
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: MALE }} /> Male
        </span>
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: FEMALE }} /> Female
        </span>
      </div>

      <svg width="100%" height={chartH} viewBox={`0 0 ${width} ${chartH}`} role="img"
        aria-label="Age and gender of the influencer panel">
        {/* Gridlines at a quarter of the max, hairline and recessive. */}
        {[0.5, 1].map((f) => (
          <g key={f}>
            <line x1={centre - scale(maxShare * f)} x2={centre - scale(maxShare * f)}
              y1={0} y2={order.length * rowH} stroke="var(--grid)" strokeWidth={1} />
            <line x1={centre + scale(maxShare * f)} x2={centre + scale(maxShare * f)}
              y1={0} y2={order.length * rowH} stroke="var(--grid)" strokeWidth={1} />
          </g>
        ))}
        <line x1={centre} x2={centre} y1={0} y2={order.length * rowH} stroke="var(--axis)" strokeWidth={1} />

        {order.map((age, i) => {
          const y = i * rowH
          const barY = y + (rowH - barH) / 2
          const m = shareOf(age, 'm')
          const f = shareOf(age, 'f')

          const show = (e: React.PointerEvent, gender: string, share: number, count: number) => {
            const r = ref.current?.getBoundingClientRect()
            if (!r) return
            setHover({
              x: e.clientX - r.left, y: e.clientY - r.top, title: `${age} · ${gender}`,
              rows: [
                { label: 'Share of panel', value: pct(share, 1), color: gender === 'Male' ? MALE : FEMALE },
                { label: 'Influencers', value: full(count) },
              ],
            })
          }

          return (
            <g key={age}>
              <text x={0} y={y + rowH / 2 + 4} fontSize={11} fill="var(--text-secondary)">{age}</text>

              {/* Male, growing left from the centre. */}
              {m > 0 ? (
                <g onPointerMove={(e) => show(e, 'Male', m, countOf(age, 'm'))} onPointerLeave={() => setHover(null)}>
                  <rect x={centre - scale(m)} y={y} width={scale(m)} height={rowH} fill="transparent" />
                  <path d={roundedLeft(centre - scale(m) - 1, barY, scale(m), barH, 4)} fill={MALE} />
                </g>
              ) : null}

              {/* Female, growing right. */}
              {f > 0 ? (
                <g onPointerMove={(e) => show(e, 'Female', f, countOf(age, 'f'))} onPointerLeave={() => setHover(null)}>
                  <rect x={centre + 1} y={y} width={scale(f)} height={rowH} fill="transparent" />
                  <path d={roundedRight(centre + 1, barY, scale(f), barH, 4)} fill={FEMALE} />
                </g>
              ) : null}
            </g>
          )
        })}

        <text x={centre - scale(maxShare)} y={chartH - 6} fontSize={10} fill="var(--text-muted)">
          {pct(maxShare, 0)}
        </text>
        <text x={centre} y={chartH - 6} fontSize={10} fill="var(--text-muted)" textAnchor="middle">0%</text>
        <text x={centre + scale(maxShare)} y={chartH - 6} fontSize={10} fill="var(--text-muted)" textAnchor="end">
          {pct(maxShare, 0)}
        </text>
      </svg>

      {hover ? (
        <Tooltip x={hover.x} y={hover.y} title={hover.title} rows={hover.rows} containerWidth={width} />
      ) : null}
    </div>
  )
}

/** Ranked shares as labelled meters — the form when the label matters as much as the bar. */
export function ShareBars({ rows, limit = 6 }: { rows: CreatorBreakdownRow[]; limit?: number }) {
  const [expanded, setExpanded] = useState(false)
  const total = rows.reduce((a, r) => a + r.count, 0)
  if (total === 0) return <div className="empty">No data.</div>

  const sorted = [...rows].sort((a, b) => b.count - a.count)
  const shown = expanded ? sorted : sorted.slice(0, limit)
  const max = Math.max(...sorted.map((r) => r.share), 0.01)

  return (
    <div>
      {shown.map((r) => (
        <div key={r.value} style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
            <span style={{ fontSize: 13, textTransform: 'capitalize' }}>{r.label}</span>
            <span style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
              {pct(r.share, 2)}
            </span>
          </div>
          {/* Track is a light step of the fill's own ramp, so state reads across the bar. */}
          <div style={{ height: 8, borderRadius: 999, background: 'var(--seq-100)', overflow: 'hidden' }}
            title={`${full(r.count)} influencers`}>
            <div style={{
              width: `${Math.max((r.share / max) * 100, 2)}%`, height: '100%',
              borderRadius: 999, background: 'var(--red)',
            }} />
          </div>
        </div>
      ))}
      {sorted.length > limit ? (
        <button className="control" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show fewer' : `View all ${sorted.length}`}
        </button>
      ) : null}
    </div>
  )
}

/** Rounded on the data end only; square where it meets the centre axis. */
function roundedRight(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2)
  if (w <= 0) return ''
  return `M${x},${y} H${x + w - rr} A${rr},${rr} 0 0 1 ${x + w},${y + rr} V${y + h - rr} A${rr},${rr} 0 0 1 ${x + w - rr},${y + h} H${x} Z`
}

function roundedLeft(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2)
  if (w <= 0) return ''
  return `M${x + w},${y} H${x + rr} A${rr},${rr} 0 0 0 ${x},${y + rr} V${y + h - rr} A${rr},${rr} 0 0 0 ${x + rr},${y + h} H${x + w} Z`
}
