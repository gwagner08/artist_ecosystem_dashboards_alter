import type { ReactNode } from 'react'

export interface TooltipRow { label: string; value: string; color?: string }

/**
 * Values lead, labels follow - the reader already knows the series and wants the
 * number. Series names go in via children/textContent, never innerHTML.
 */
export function Tooltip({ x, y, title, rows, containerWidth }: {
  x: number; y: number; title: string; rows: TooltipRow[]; containerWidth: number
}) {
  const width = 190
  const flip = x + width + 20 > containerWidth
  const style = { left: flip ? x - width - 14 : x + 14, top: Math.max(y - 12, 4), width }

  return (
    <div className="tooltip" style={style} role="status">
      <div className="tooltip-title">{title}</div>
      {rows.map((r) => (
        <div className="tooltip-row" key={r.label}>
          {r.color ? <span className="k" style={{ background: r.color }} /> : null}
          <span className="n">{r.label}</span>
          <span className="v">{r.value}</span>
        </div>
      ))}
    </div>
  )
}

export function Legend({ items, kind = 'line' }: {
  items: Array<{ label: string; color: string }>; kind?: 'line' | 'swatch'
}) {
  // One series needs no legend - the title already names what is plotted.
  if (items.length < 2) return null
  return (
    <div className="legend">
      {items.map((i) => (
        <span className="legend-item" key={i.label}>
          <span className={kind === 'line' ? 'legend-line' : 'legend-swatch'} style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  )
}

export function Card({ title, caption, action, children }: {
  title: string; caption?: string; action?: ReactNode; children: ReactNode
}) {
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          {caption ? <p className="caption">{caption}</p> : <div style={{ height: 12 }} />}
        </div>
        <div className="spacer" />
        {action}
      </div>
      {children}
    </section>
  )
}
