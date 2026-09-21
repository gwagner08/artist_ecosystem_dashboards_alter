import type { MetricDelta } from '@shared/types.ts'
import { Sparkline } from '../charts/Sparkline.tsx'
import { signedPct } from '../format.ts'

/**
 * label / value / delta / trend. Direction colour assumes up-is-good; pass
 * `upIsGood={false}` where it isn't.
 */
export function StatTile({ label, value, delta, deltaNote, trend, trendColor, hero, upIsGood = true }: {
  label: string
  value: string
  delta?: MetricDelta | null
  deltaNote?: string
  trend?: Array<number | null>
  trendColor?: string
  hero?: boolean
  upIsGood?: boolean
}) {
  const change = delta?.changePct ?? null
  const direction = change == null || Math.abs(change) < 0.0005 ? 'flat' : change > 0 ? 'up' : 'down'
  const good = direction === 'flat' ? 'flat' : (direction === 'up') === upIsGood ? 'up' : 'down'

  return (
    <div className={`card${hero ? ' hero' : ''}`}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      <div className="tile-foot">
        {change != null ? (
          <>
            <span className={`delta ${good}`}>{signedPct(change)}</span>
            <span className="delta-note">{deltaNote ?? 'vs prior period'}</span>
          </>
        ) : (
          <span className="delta-note">{deltaNote ?? 'no comparison available'}</span>
        )}
        <div style={{ flex: 1 }} />
        {trend ? <Sparkline values={trend} color={trendColor} /> : null}
      </div>
    </div>
  )
}
