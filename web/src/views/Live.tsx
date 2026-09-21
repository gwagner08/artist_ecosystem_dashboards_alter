import { useState } from 'react'
import type { ArtistEcosystem, MarketConversion } from '@shared/types.ts'
import { BarChart } from '../charts/BarChart.tsx'
import { ScatterChart } from '../charts/ScatterChart.tsx'
import { StatTile } from '../components/StatTile.tsx'
import { Card } from '../components/Tooltip.tsx'
import { compact, full, pct, shortDate } from '../format.ts'

/**
 * Brand palette is red / black / white, so verdicts encode as attention vs neutral
 * rather than a traffic light. Red is the one that needs a decision; the text label
 * carries the rest, and underplayed is self-evident from a bar that hits 100%.
 */
const VERDICT: Record<MarketConversion['verdict'], { label: string; color: string }> = {
  underconverting: { label: 'Underconverting', color: 'var(--attention)' },
  'on-track': { label: 'On track', color: 'var(--neutral-mark)' },
  underplayed: { label: 'Underplayed', color: 'var(--neutral-mark)' },
  unknown: { label: 'No listener data', color: 'var(--text-muted)' },
}

/**
 * Box office, and the join to streaming demand.
 *
 * RealCount is artist-level, so this tab is deliberately not scoped by the
 * account-type or platform filters - a fan page has no box office. Only the date
 * range applies.
 */
export function Live({ data }: { data: ArtistEcosystem }) {
  const [showAllShows, setShowAllShows] = useState(false)

  const markets = data.live.markets
  const marketsWithListeners = markets.filter((m) => m.listeners != null)
  const sellThrough = data.live.totalCapacity > 0 ? data.live.totalSold / data.live.totalCapacity : null

  const upcoming = data.live.events.filter((e) => e.daysToShow >= 0)
  const shows = showAllShows ? data.live.events : upcoming.length ? upcoming : data.live.events

  if (data.live.events.length === 0) {
    return (
      <div className="card">
        <div className="empty">
          No RealCount events for {data.artist.name} in this range.<br />
          If RealCount books them under a different name, set <code>realcountArtistName</code> in
          {' '}<code>config/artists.json</code>.
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="section-title">Box office</div>
      <div className="grid cards">
        <StatTile hero label="Tickets sold" value={full(data.live.totalSold)}
          deltaNote={`${data.live.events.length} shows in window`} />
        <StatTile label="Tour sell-through" value={pct(sellThrough, 0)}
          deltaNote={`${full(data.live.totalSold)} of ${full(data.live.totalCapacity)} capacity`} />
        {/* Gross is not available on this RealCount account, so the fourth tile
            carries something actionable instead: rooms that may have been too small. */}
        <StatTile
          label="Shows at 90%+"
          value={String(data.live.events.filter((e) => e.sellThrough >= 0.9).length)}
          deltaNote="candidates for a bigger room"
        />
        <StatTile label="Sold last 7 days" value={full(data.live.events.reduce((a, e) => a + e.last7Sold, 0))}
          deltaNote="across upcoming shows" />
      </div>

      <div className="section-title">Demand to live conversion</div>
      <div className="grid two-col">
        <Card
          title="Listening demand vs ticket sell-through"
          caption="One dot per tour market. Bottom-right is the money question: heavy listening, soft ticket sales."
        >
          <ScatterChart
            points={marketsWithListeners.map((m) => ({
              key: m.city, label: m.city, x: m.listeners!, y: m.sellThrough,
              color: VERDICT[m.verdict].color,
            }))}
            xLabel="Monthly listeners in market"
            yLabel="Sell-through"
            yRefLine={sellThrough ?? undefined}
          />
        </Card>
        <Card title="Sell-through by market" caption="Sorted by listener base. Red marks a market that needs a decision; the verdict label carries the detail.">
          <BarChart
            bars={markets.slice(0, 10).map((m) => ({
              key: m.city, label: m.city,
              sublabel: m.listeners != null ? `${compact(m.listeners)} listeners` : 'no data',
              value: m.sellThrough, color: VERDICT[m.verdict].color, note: VERDICT[m.verdict].label,
            }))}
            max={1} valueFormat={(v) => pct(v, 0)} axisLabel="Tickets sold ÷ capacity" />
        </Card>
      </div>

      <Card
        title="Markets"
        caption="Underconverting = a real listener base that is not buying tickets. Underplayed = selling out against a modest listener base; the room was probably too small."
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Market</th><th className="num">Listeners</th><th className="num">Capacity</th>
                <th className="num">Sold</th><th className="num">Sell-through</th>
                <th className="num">Tickets / 1K listeners</th><th>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {markets.map((m) => (
                <tr key={m.city}>
                  <td>{m.city} <span className="muted">{m.country}</span></td>
                  <td className="num">{compact(m.listeners)}</td>
                  <td className="num">{full(m.capacity)}</td>
                  <td className="num">{full(m.sold)}</td>
                  <td className="num">{pct(m.sellThrough, 0)}</td>
                  <td className="num" title={m.matchedBy === 'coordinates' ? 'Matched to listener city by coordinates' : m.matchedBy === 'name' ? 'Matched by city name' : 'No listener city matched'}>
                    {m.ticketsPer1kListeners == null ? '—' : m.ticketsPer1kListeners.toFixed(1)}
                  </td>
                  <td>
                    <span className="pill">
                      <span className="dot" style={{ background: VERDICT[m.verdict].color }} />
                      {VERDICT[m.verdict].label}
                    </span>
                  </td>
                </tr>
              ))}
              {markets.length === 0 ? <tr><td colSpan={7} className="empty">No box office data for this artist.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="section-title">Shows</div>
      <Card title={showAllShows ? 'All shows' : upcoming.length ? 'Upcoming shows' : 'Shows'}
        caption={showAllShows || !upcoming.length
          ? 'Every event in the window, nearest first.'
          : `${upcoming.length} upcoming. Past shows are hidden.`}
        action={data.live.events.length > upcoming.length ? (
          <button className="control" onClick={() => setShowAllShows((v) => !v)} aria-pressed={showAllShows}>
            {showAllShows ? 'Upcoming only' : `Show all ${data.live.events.length}`}
          </button>
        ) : undefined}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Show</th><th>Market</th><th className="num">Capacity</th>
                <th className="num">Sold</th><th className="num">Sell-through</th>
                <th className="num">Last 7d</th><th className="num">Days out</th><th />
              </tr>
            </thead>
            <tbody>
              {shows.map((e) => (
                <tr key={e.id}>
                  <td>{shortDate(e.eventDate)}</td>
                  <td>{e.venue}</td>
                  <td>{e.city} <span className="muted">{e.country}</span></td>
                  <td className="num">{full(e.capacity)}</td>
                  <td className="num">{full(e.sold)}</td>
                  <td className="num">{pct(e.sellThrough, 0)}</td>
                  <td className="num">{full(e.last7Sold)}</td>
                  <td className="num">{e.daysToShow >= 0 ? e.daysToShow : 'past'}</td>
                  <td>
                    {e.soldOut ? <span className="pill"><span className="dot" style={{ background: 'var(--neutral-mark)' }} />Sold out</span>
                      : e.isFinal ? <span className="reason">final</span> : null}
                  </td>
                </tr>
              ))}
              {data.live.events.length === 0 ? <tr><td colSpan={9} className="empty">No shows.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>

      <div style={{ height: 16 }} />
    </>
  )
}
