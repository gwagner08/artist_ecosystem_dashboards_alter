import { useMemo, useState } from 'react'
import type { ArtistEcosystem } from '@shared/types.ts'
import { LineChart, type Series } from '../charts/LineChart.tsx'
import { BarChart } from '../charts/BarChart.tsx'
import { StatTile } from '../components/StatTile.tsx'
import { Card } from '../components/Tooltip.tsx'
import { compact, full, pct, NETWORK_LABEL, networkColor } from '../format.ts'

const BASIS_LABEL: Record<string, string> = {
  reach: 'reach (unique viewers)',
  impressions: 'impressions',
  views: 'views',
}

export function ArtistDetail({ data }: { data: ArtistEcosystem }) {
  const [showTables, setShowTables] = useState(false)

  const followerSeries: Series[] = useMemo(() => {
    const byNetwork = new Map<string, Map<string, number>>()
    for (const d of data.social.daily) {
      if (d.followers == null) continue
      const m = byNetwork.get(d.network) ?? new Map<string, number>()
      // Sum across profiles on the same network before plotting.
      m.set(d.date, (m.get(d.date) ?? 0) + d.followers)
      byNetwork.set(d.network, m)
    }
    return [...byNetwork.entries()].map(([network, m]) => ({
      key: network,
      label: NETWORK_LABEL[network] ?? network,
      color: networkColor(network),
      points: [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value })),
    }))
  }, [data.social.daily])

  const engagementSeries: Series[] = useMemo(() => {
    const byNetwork = new Map<string, Map<string, number>>()
    for (const d of data.social.daily) {
      if (d.engagements == null) continue
      const m = byNetwork.get(d.network) ?? new Map<string, number>()
      m.set(d.date, (m.get(d.date) ?? 0) + d.engagements)
      byNetwork.set(d.network, m)
    }
    return [...byNetwork.entries()].map(([network, m]) => ({
      key: network,
      label: NETWORK_LABEL[network] ?? network,
      color: networkColor(network),
      points: [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value })),
    }))
  }, [data.social.daily])

  const listenerSeries: Series[] = data.streaming.series.length
    ? [{
        key: 'listeners', label: 'Spotify monthly listeners', color: 'var(--series-1)',
        points: data.streaming.series.map((p) => ({ date: p.date, value: p.spotifyListeners })),
      }]
    : []

  const totalFollowers = data.social.byNetwork.reduce((a, n) => a + (n.followers.current ?? 0), 0)
  const prevFollowers = data.social.byNetwork.reduce((a, n) => a + (n.followers.previous ?? 0), 0)
  const {
    engagementRate: engRate, previousEngagementRate: prevEngRate,
    excludedNetworks, bases,
  } = data.social.reach
  const sellThrough = data.live.totalCapacity > 0 ? data.live.totalSold / data.live.totalCapacity : null

  const followerTrend = useMemo(() => {
    const byDate = new Map<string, number>()
    for (const d of data.social.daily) {
      if (d.followers == null) continue
      byDate.set(d.date, (byDate.get(d.date) ?? 0) + d.followers)
    }
    const sorted = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v)
    const stride = Math.max(1, Math.floor(sorted.length / 12))
    return sorted.filter((_, i) => i % stride === 0).slice(-12)
  }, [data.social.daily])

  const markets = data.live.markets
  const marketsWithListeners = markets.filter((m) => m.listeners != null)

  return (
    <>
      <div className="section-title">Reach</div>
      <div className="grid cards">
        <StatTile hero label="Total social followers" value={compact(totalFollowers || null)}
          delta={{ current: totalFollowers, previous: prevFollowers, changePct: prevFollowers > 0 ? (totalFollowers - prevFollowers) / prevFollowers : null }}
          trend={followerTrend} trendColor="var(--series-1)" />
        <StatTile label="Spotify monthly listeners" value={compact(data.streaming.monthlyListeners.current)}
          delta={data.streaming.monthlyListeners}
          trend={data.streaming.series.slice(-12).map((p) => p.spotifyListeners)} trendColor="var(--series-3)" />
        <StatTile label="Engagement rate" value={pct(engRate, 2)}
          delta={{ current: engRate, previous: prevEngRate, changePct: engRate != null && prevEngRate ? (engRate - prevEngRate) / prevEngRate : null }}
          deltaNote={
            // The denominator differs per network, so name it rather than leaving
            // someone to assume impressions.
            (bases.length
              ? `engagements ÷ ${bases.map((b) => BASIS_LABEL[b] ?? b).join(' / ')}`
              : 'no denominator available')
            + (excludedNetworks.length
              ? ` · excludes ${excludedNetworks.map((n) => NETWORK_LABEL[n] ?? n).join(', ')}`
              : '')
          } />
        <StatTile label="Tour sell-through" value={pct(sellThrough, 0)}
          deltaNote={data.live.events.length ? `${full(data.live.totalSold)} sold — see the Live tab` : 'no shows in range'} />
      </div>

      <div className="section-title">Audience over time</div>
      <div className="grid two-col">
        <Card title="Followers by network" caption="Daily follower count, summed across profiles on each network.">
          <LineChart series={followerSeries} />
        </Card>
        <Card title="Engagements by network"
          caption="Likes, comments, shares and saves. Metric availability differs per network — YouTube reports none at profile level.">
          <LineChart series={engagementSeries} />
        </Card>
      </div>

      {data.filters.accountType !== 'all' || data.filters.network !== 'all' ? (
        <div className="banner" style={{ marginTop: 24 }}>
          <strong>Streaming is artist-level.</strong> Chartmetric has no notion of individual
          social accounts, so Consumption below is not scoped by the account-type or platform
          filter. Only Reach, Audience and Posts are.
        </div>
      ) : null}

      <Card
        title="Engagement rate by network"
        caption="Reach is unique viewers and the right denominator; impressions double-counts repeat viewers. Where a network reports neither — TikTok at profile level — views stand in, and the basis column says so."
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Network</th><th className="num">Reach</th><th className="num">Impressions</th>
                <th className="num">Engagements</th><th className="num">Eng. rate</th><th>Divided by</th>
              </tr>
            </thead>
            <tbody>
              {data.social.byNetwork.map((n) => (
                <tr key={n.network}>
                  <td>
                    <span className="legend-swatch" style={{ background: networkColor(n.network), display: 'inline-block', marginRight: 6 }} />
                    {NETWORK_LABEL[n.network] ?? n.network}
                  </td>
                  <td className="num">{compact(n.reach.current)}</td>
                  <td className="num">{compact(n.impressions.current)}</td>
                  <td className="num">{compact(n.engagements.current)}</td>
                  <td className="num">{pct(n.engagementRate, 2)}</td>
                  <td className="reason">
                    {n.engagementBasis ? BASIS_LABEL[n.engagementBasis] : 'no denominator'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="section-title">Consumption</div>
      <div className="grid two-col">
        <Card
          title="Spotify monthly listeners"
          caption={data.streaming.followerConversion != null
            ? `${pct(data.streaming.followerConversion, 1)} of listeners follow the artist — the share of casual listening that has converted to committed fandom.`
            : data.streaming.series.length
              // Listeners plotted but no follower count, so the ratio cannot be shown.
              ? 'Follower count unavailable, so the listener-to-follower ratio is not shown.'
              : 'No Chartmetric data for this artist yet.'}
          action={
            // An automatic name match can land on the wrong artist, so make it one
            // click to confirm rather than something to take on trust.
            data.streaming.source.artistId != null ? (
              <a
                className="pill"
                href={`https://app.chartmetric.com/artist/${data.streaming.source.artistId}`}
                target="_blank"
                rel="noreferrer"
                style={{ textDecoration: 'none', color: 'inherit' }}
                title={
                  data.streaming.source.matchedBy === 'name'
                    ? 'Matched automatically by name. Open to confirm it is the right artist.'
                    : 'Pinned in config/artists.json. Open to confirm.'
                }
              >
                {data.streaming.source.matchedBy === 'name' ? 'matched by name' : 'pinned'}
                {' · '}
                {data.streaming.source.artistId}
              </a>
            ) : null
          }
        >
          <LineChart series={listenerSeries} />
        </Card>
        <Card title="Top listener cities" caption="Where the streaming audience actually is. The first ten markets by monthly listeners.">
          <BarChart
            bars={data.streaming.cities.slice(0, 10).map((c) => ({
              key: `${c.city}-${c.country}`, label: c.city, sublabel: c.country,
              value: c.listeners, color: 'var(--seq-400)',
            }))}
            valueFormat={(v) => compact(v)} axisLabel="Monthly listeners" />
        </Card>
      </div>

      {data.ugc.available ? (
        <>
          <div className="section-title">Creator activity</div>
          <div className="grid two-col">
            <Card
              title="UGC at a glance"
              caption="Content other people are making with this artist's music. The UGC tab has the sounds, the creators and the videos."
            >
              <div className="grid cards" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
                <div>
                  <div className="tile-label">Posts</div>
                  <div className="tile-value" style={{ fontSize: 26 }}>{compact(data.ugc.totals.posts)}</div>
                </div>
                <div>
                  <div className="tile-label">Views on them</div>
                  <div className="tile-value" style={{ fontSize: 26 }}>{compact(data.ugc.totals.views)}</div>
                </div>
                <div>
                  <div className="tile-label">Influencers tracked</div>
                  <div className="tile-value" style={{ fontSize: 26 }}>
                    {full(data.ugc.breakdown?.total ?? data.ugc.creators.length)}
                  </div>
                  <div className="reason">a panel, not all creators</div>
                </div>
              </div>
            </Card>

            <Card title="Sounds driving it" caption="Top three by creator posts.">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Sound</th><th className="num">Posts</th><th className="num">Views</th></tr>
                  </thead>
                  <tbody>
                    {data.ugc.sounds.slice(0, 3).map((s) => (
                      <tr key={s.trackId ?? s.platformSoundId ?? s.name}>
                        <td style={{ whiteSpace: 'normal', maxWidth: 260 }}>{s.name}</td>
                        <td className="num">{compact(s.posts)}</td>
                        <td className="num">{compact(s.views)}</td>
                      </tr>
                    ))}
                    {data.ugc.sounds.length === 0 ? (
                      <tr><td colSpan={3} className="empty">No sounds returned.</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </>
      ) : null}

      <Card
        title="Top posts"
        caption={`Ranked by total engagements in the selected window.${
          data.filters.accountType === 'all' ? '' : ` ${data.filters.accountType === 'fan' ? 'Fan accounts' : 'Artist-owned accounts'} only.`
        }`}
        action={
          <button className="control" onClick={() => setShowTables((v) => !v)} aria-pressed={showTables}>
            {showTables ? 'Hide' : 'Show'} data tables
          </button>
        }
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Network</th><th>Post</th><th className="num">Impressions</th>
                <th className="num">Engagements</th><th className="num">Eng. rate</th>
              </tr>
            </thead>
            <tbody>
              {data.social.topPosts.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="legend-swatch" style={{ background: networkColor(p.network), display: 'inline-block', marginRight: 6 }} />
                    {NETWORK_LABEL[p.network] ?? p.network}
                  </td>
                  <td style={{ maxWidth: 380, whiteSpace: 'normal' }}>
                    {p.permalink
                      ? <a href={p.permalink} target="_blank" rel="noreferrer">{p.text.slice(0, 90) || '(no caption)'}</a>
                      : p.text.slice(0, 90) || '(no caption)'}
                  </td>
                  <td className="num">{compact(p.impressions)}</td>
                  <td className="num">{compact(p.engagements)}</td>
                  <td className="num">{pct(p.engagementRate, 2)}</td>
                </tr>
              ))}
              {data.social.topPosts.length === 0 ? <tr><td colSpan={5} className="empty">No posts in this window.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>

      {showTables ? (
        <>
          <div style={{ height: 16 }} />
          <Card title="Daily social data" caption="The full series behind the charts above.">
            <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Date</th><th>Network</th><th className="num">Followers</th><th className="num">Net growth</th>
                    <th className="num">Impressions</th><th className="num">Engagements</th><th className="num">Video views</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.social.daily].sort((a, b) => b.date.localeCompare(a.date)).map((d, i) => (
                    <tr key={`${d.date}-${d.customerProfileId}-${i}`}>
                      <td>{d.date}</td>
                      <td>{NETWORK_LABEL[d.network] ?? d.network}</td>
                      <td className="num">{full(d.followers)}</td>
                      <td className="num">{full(d.netFollowerGrowth)}</td>
                      <td className="num">{full(d.impressions)}</td>
                      <td className="num">{full(d.engagements)}</td>
                      <td className="num">{full(d.videoViews)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}
    </>
  )
}
