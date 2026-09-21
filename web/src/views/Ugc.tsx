import { useEffect, useMemo, useState } from 'react'
import type { ArtistEcosystem, CreatorDimension, UgcSound, UgcVideo } from '@shared/types.ts'
import { BarChart } from '../charts/BarChart.tsx'
import { AgePyramid, GenderDonut, ShareBars, genderSplit } from '../charts/Demographics.tsx'
import { StatTile } from '../components/StatTile.tsx'
import { Card } from '../components/Tooltip.tsx'
import { getCreatorBreakdown, getSoundVideos } from '../api.ts'
import { compact, full, pct, shortDate } from '../format.ts'

const DIMENSIONS: Array<{ key: CreatorDimension; label: string }> = [
  { key: 'country', label: 'Country' },
  { key: 'age-gender', label: 'Age & gender' },
  { key: 'category', label: 'Category' },
  { key: 'subcategory', label: 'Subcategory' },
  { key: 'language', label: 'Language' },
]

const VIDEO_SORTS = [
  { key: 'views', label: 'Views' },
  { key: 'likes', label: 'Likes' },
  { key: 'comments', label: 'Comments' },
  { key: 'shares', label: 'Shares' },
  { key: 'created_at', label: 'Newest' },
] as const

/** Age-gender arrives as "25-34|female"; make it readable without losing the value. */
function prettyLabel(value: string): string {
  if (!value.includes('|')) return value
  const [age, gender] = value.split('|')
  return `${age} ${gender}`
}

export function Ugc({ data }: { data: ArtistEcosystem }) {
  const { ugc } = data
  const [dimension, setDimension] = useState<CreatorDimension>('country')
  const [breakdown, setBreakdown] = useState(ugc.breakdown)
  const [loadingDim, setLoadingDim] = useState(false)
  const [openSound, setOpenSound] = useState<UgcSound | null>(null)

  const artistId = data.streaming.source.artistId

  useEffect(() => {
    // The artist payload ships the country breakdown; the other dimensions are
    // fetched on demand so switching is cheap and the page load is not.
    if (dimension === 'country' && ugc.breakdown?.dimension === 'country') {
      setBreakdown(ugc.breakdown)
      return
    }
    if (artistId == null) return
    let cancelled = false
    setLoadingDim(true)
    getCreatorBreakdown(artistId, dimension, ugc.windowDays)
      .then((b) => { if (!cancelled) setBreakdown(b) })
      .catch(() => { if (!cancelled) setBreakdown(null) })
      .finally(() => { if (!cancelled) setLoadingDim(false) })
    return () => { cancelled = true }
  }, [dimension, artistId, ugc.breakdown, ugc.windowDays])

  if (artistId == null) {
    return (
      <div className="card">
        <div className="empty">
          UGC comes from Chartmetric, and this artist has no Chartmetric match.<br />
          Pin a <code>chartmetricArtistId</code> in <code>config/artists.json</code>, or run{' '}
          <code>npm run check:chartmetric</code>.
        </div>
      </div>
    )
  }

  if (!ugc.available) {
    return (
      <div className="card">
        <div className="empty">
          No UGC data came back for this artist.<br />
          These are premium Chartmetric endpoints — if your plan excludes them, every
          UGC request returns empty rather than an error, which looks the same as an
          artist with no creator activity.
        </div>
      </div>
    )
  }

  const topSound = ugc.sounds[0]

  return (
    <>
      {/*
        Chartmetric's top-tracks endpoint has no date filter, so sounds are all-time
        whatever the range says. Rather than let the range look broken, say which
        panels it actually scopes.
      */}
      <div className="banner">
        <strong>The date range scopes creators and videos, not sounds.</strong>{' '}
        Chartmetric's sounds endpoint has no date filter, so sound totals below are
        all-time. Creator breakdown and videos are the last <strong>{ugc.windowDays} days</strong>.
      </div>

      <div className="section-title">Creator activity</div>
      <div className="grid cards">
        <StatTile hero label="Posts using these sounds" value={compact(ugc.totals.posts)}
          deltaNote={`all time, across ${ugc.sounds.length} sound${ugc.sounds.length === 1 ? '' : 's'}`} />
        <StatTile label="Views on those posts" value={compact(ugc.totals.views)}
          deltaNote="all time, TikTok" />
        <StatTile label="Influencers in panel" value={full(breakdown?.total ?? ugc.creators.length)}
          deltaNote={breakdown ? `tracked, last ${breakdown.periodDays} days` : 'tracked panel'} />
        <StatTile label="Videos in range" value={full(ugc.recentVideos.length)}
          deltaNote={`posted in the last ${ugc.windowDays} days`} />
      </div>

      {ugc.recentVideos.length > 0 ? (
        <>
          <div className="section-title">Videos in range</div>
          <Card
            title={`Top videos posted in the last ${ugc.windowDays} days`}
            caption="Across every sound, sorted by views. Change the range above to widen or narrow this."
          >
            <div className="posts-grid">
              {ugc.recentVideos.map((v) => <VideoCard key={v.videoId} video={v} />)}
            </div>
          </Card>
        </>
      ) : null}

      <div className="section-title">Sounds</div>
      <Card
        title="Top sounds by creator posts"
        caption="All time — this endpoint has no date filter. Select a sound to see its videos, which DO respect the range. Posts counts pieces of content made with the sound; views are on those posts, not the artist's own upload."
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sound</th>
                <th className="num">Posts</th>
                <th className="num">Views</th>
                <th className="num">Likes</th>
                <th className="num">Eng. rate</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ugc.sounds.map((s) => (
                <tr key={`${s.trackId ?? s.platformSoundId ?? s.name}`}
                  className={openSound && soundKey(openSound) === soundKey(s) ? 'roster-row' : undefined}>
                  <td style={{ maxWidth: 320, whiteSpace: 'normal' }}>
                    <strong>{s.name}</strong>
                    {s.isrc ? <div className="reason">{s.isrc}</div> : null}
                  </td>
                  <td className="num">{compact(s.posts)}</td>
                  <td className="num">{compact(s.views)}</td>
                  <td className="num">{compact(s.likes)}</td>
                  <td className="num">{pct(s.engagementRate, 2)}</td>
                  <td>
                    {s.trackId != null || s.platformSoundId ? (
                      <button className="control" onClick={() => setOpenSound(
                        openSound && soundKey(openSound) === soundKey(s) ? null : s,
                      )}>
                        {openSound && soundKey(openSound) === soundKey(s) ? 'Hide videos' : 'Top videos'}
                      </button>
                    ) : <span className="reason">no id</span>}
                  </td>
                </tr>
              ))}
              {ugc.sounds.length === 0 ? (
                <tr><td colSpan={6} className="empty">No sounds returned.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      {openSound ? (
        <>
          <div style={{ height: 16 }} />
          <SoundVideos sound={openSound} windowDays={ugc.windowDays} onClose={() => setOpenSound(null)} />
        </>
      ) : null}

      <div className="section-title">Who is using them</div>
      <InfluencerDemographics ugc={ugc} />

      <div className="banner">
        <strong>This is Chartmetric's tracked influencer panel, not every creator.</strong>{' '}
        The endpoint behind it (<code>tiktok-influencer-stats</code>) covers accounts Chartmetric
        classifies as influencers, so the totals are far smaller than the real creator count and
        the geography skews to large accounts in major markets. Compare it against the videos
        above, where creators from outside the panel show up. Use it for direction, not for
        counting reach.
      </div>
      <div className="grid two-col">
        <Card
          title="Influencer panel breakdown"
          caption={breakdown
            ? `${full(breakdown.total)} tracked influencers in the last ${breakdown.periodDays} days. Share is of the panel, not of all creators.`
            : 'No breakdown returned for this dimension.'}
          action={
            <select className="control" value={dimension}
              onChange={(e) => setDimension(e.target.value as CreatorDimension)}
              aria-label="Breakdown dimension">
              {DIMENSIONS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          }
        >
          <div className={loadingDim ? 'loading' : undefined}>
            <BarChart
              bars={(breakdown?.rows ?? []).slice(0, 10).map((r) => ({
                key: r.value,
                label: prettyLabel(r.label),
                sublabel: r.delta == null ? undefined : `${r.delta >= 0 ? '+' : ''}${r.delta}`,
                value: r.share,
                color: 'var(--seq-400)',
                note: `${full(r.count)} creators`,
              }))}
              max={Math.max(...(breakdown?.rows ?? [{ share: 1 }]).map((r) => r.share), 0.01)}
              valueFormat={(v) => pct(v, 1)}
              axisLabel="Share of creators"
            />
          </div>
        </Card>

        <Card
          title="Influencer panel table"
          caption="The same figures. Change is against the previous period of the same length, where Chartmetric supplies it."
        >
          <div className="table-wrap" style={{ maxHeight: 380, overflowY: 'auto' }}>
            <table>
              <thead>
                <tr><th>{DIMENSIONS.find((d) => d.key === dimension)?.label}</th>
                  <th className="num">Influencers</th><th className="num">Share of panel</th>
                  <th className="num">Change</th></tr>
              </thead>
              <tbody>
                {(breakdown?.rows ?? []).map((r) => (
                  <tr key={r.value}>
                    <td>{prettyLabel(r.label)}</td>
                    <td className="num">{full(r.count)}</td>
                    <td className="num">{pct(r.share, 1)}</td>
                    <td className="num">
                      {r.delta == null ? '—' : (
                        <span className={`delta ${r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : 'flat'}`}>
                          {r.delta > 0 ? '+' : ''}{r.delta}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {(breakdown?.rows ?? []).length === 0 ? (
                  <tr><td colSpan={4} className="empty">Nothing for this dimension.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="section-title">Top influencers</div>
      <Card
        title="Tracked influencers using these sounds"
        caption="From the same panel, sorted by follower count. A creator absent here may still have used the sound — the videos section is the fuller picture."
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Creator</th><th className="num">Followers</th><th className="num">Avg views</th>
                <th className="num">Eng. rate</th><th className="num">Videos</th>
                <th>Categories</th><th>Featured sound</th>
              </tr>
            </thead>
            <tbody>
              {ugc.creators.map((c) => (
                <tr key={c.handle}>
                  <td>
                    <a href={`https://www.tiktok.com/@${c.handle.replace(/^@/, '')}`}
                      target="_blank" rel="noreferrer">
                      {c.handle.startsWith('@') ? c.handle : `@${c.handle}`}
                    </a>
                    {c.isVerified ? <span className="reason"> · verified</span> : null}
                    {c.country ? <div className="reason">{c.country.toUpperCase()}
                      {c.ageGroup ? ` · ${c.ageGroup}` : ''}{c.gender ? ` · ${c.gender}` : ''}</div> : null}
                  </td>
                  <td className="num">{compact(c.followers)}</td>
                  <td className="num">{compact(c.avgViews)}</td>
                  <td className="num">{pct(c.engagementRate, 1)}</td>
                  <td className="num">{full(c.videoCount)}</td>
                  <td style={{ whiteSpace: 'normal', maxWidth: 180 }}>{c.categories.join(', ') || '—'}</td>
                  <td style={{ whiteSpace: 'normal', maxWidth: 200 }}>{c.featuredTrack ?? '—'}</td>
                </tr>
              ))}
              {ugc.creators.length === 0 ? (
                <tr><td colSpan={7} className="empty">No creators returned.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

const soundKey = (s: UgcSound) => `${s.trackId ?? ''}:${s.platformSoundId ?? ''}:${s.name}`

/** Videos using one sound, on TikTok or as YouTube Shorts. */
function SoundVideos({ sound, windowDays, onClose }: {
  sound: UgcSound; windowDays: number; onClose: () => void
}) {
  const [platform, setPlatform] = useState<'tiktok' | 'youtube'>('tiktok')
  const [sort, setSort] = useState<string>('views')
  const [inRange, setInRange] = useState(true)
  const [videos, setVideos] = useState<UgcVideo[] | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Prefer the Chartmetric track id; fall back to the platform sound id.
  const id = sound.trackId ?? sound.platformSoundId
  const bySoundId = sound.trackId == null

  useEffect(() => {
    if (id == null) return
    let cancelled = false
    setLoading(true)
    setError(null)
    getSoundVideos(String(id), { platform, type: sort, bySoundId, days: inRange ? windowDays : undefined })
      .then((r) => {
        if (cancelled) return
        setVideos(r.videos)
        setTotal(r.total)
      })
      .catch((e) => { if (!cancelled) setError((e as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id, platform, sort, bySoundId, inRange, windowDays])

  const rows = useMemo(() => videos ?? [], [videos])

  return (
    <Card
      title={`Videos using “${sound.name}”`}
      caption={
        (inRange ? `Posted in the last ${windowDays} days. ` : 'All time. ') +
        (total != null ? `${compact(total)} total views across this sound.` : '') +
        (platform === 'youtube' && inRange
          ? ' Shorts have no server-side date filter, so these are pulled by recency and then windowed.'
          : '')
      }
      action={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="seg" role="group" aria-label="Platform">
            <button aria-pressed={platform === 'tiktok'} onClick={() => setPlatform('tiktok')}>TikTok</button>
            <button aria-pressed={platform === 'youtube'} onClick={() => setPlatform('youtube')}>Shorts</button>
          </div>
          <div className="seg" role="group" aria-label="Window">
            <button aria-pressed={inRange} onClick={() => setInRange(true)}>{windowDays}d</button>
            <button aria-pressed={!inRange} onClick={() => setInRange(false)}>All time</button>
          </div>
          <select className="control" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort videos">
            {VIDEO_SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <button className="control" onClick={onClose}>Close</button>
        </div>
      }
    >
      {error ? <div className="empty">{error}</div> : null}

      <div className={loading ? 'loading' : undefined}>
        {rows.length === 0 && !loading ? (
          <div className="empty">
            No {platform === 'youtube' ? 'Shorts' : 'TikTok videos'} returned for this sound
            {inRange ? ` in the last ${windowDays} days` : ''}.
            {inRange ? ' Try All time.' : ''}
            {platform === 'youtube' ? ' Shorts data needs a YouTube track id, which not every sound has.' : ''}
          </div>
        ) : (
          <div className="posts-grid">
            {rows.map((v) => (
              <VideoCard key={v.videoId} video={v} />
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

function VideoCard({ video: v }: { video: UgcVideo }) {
  const body = (
    <>
      <div className="post-thumb">
        <div className="post-badges">
          <span className="net-badge" style={{ background: 'var(--series-1)' }}>UGC</span>
        </div>
        {v.createdAt ? <span className="post-age">{shortDate(v.createdAt.slice(0, 10))}</span> : null}
      </div>
      <div className="post-body">
        <span className="post-handle">
          {v.username ? (v.username.startsWith('@') ? v.username : `@${v.username}`) : 'unknown creator'}
        </span>
        <div className="post-metrics">
          <span><b>{compact(v.views)}</b> views</span>
          <span><b>{compact(v.likes)}</b> likes</span>
        </div>
        <div className="post-metrics">
          <span><b>{compact(v.comments)}</b> comments</span>
          {v.shares != null ? <span><b>{compact(v.shares)}</b> shares</span> : null}
        </div>
        {v.viewsPercentChange != null ? (
          <div className="post-metrics">
            <span className={`delta ${v.viewsPercentChange >= 0 ? 'up' : 'down'}`}>
              {v.viewsPercentChange >= 0 ? '+' : ''}{v.viewsPercentChange.toFixed(1)}% views
            </span>
          </div>
        ) : null}
        {v.title ? <p className="post-text">{v.title}</p> : null}
      </div>
    </>
  )

  return v.link ? (
    <a className="post-card" href={v.link} target="_blank" rel="noreferrer"
      style={{ color: 'inherit', textDecoration: 'none' }}>{body}</a>
  ) : (
    <div className="post-card">{body}</div>
  )
}

/**
 * The influencer panel's own age, gender and language mix, laid out the way
 * Chartmetric presents it: gender donut, age pyramid, ranked language shares.
 *
 * These are the influencers themselves, not their audiences - Chartmetric's own card
 * shows audience demographics, which is a different aggregate this endpoint does not
 * return. Named accordingly so the two are not confused.
 */
function InfluencerDemographics({ ugc }: { ugc: ArtistEcosystem['ugc'] }) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const { ageGender, language, total } = ugc.demographics

  if (ageGender.length === 0 && language.length === 0) return null

  const split = genderSplit(ageGender)
  const topLanguage = [...language].sort((a, b) => b.count - a.count)[0]
  const topAge = [...ageGender].sort((a, b) => b.count - a.count)[0]

  const summary = [
    topAge?.ageGroup ? `mostly ${topAge.ageGroup}` : null,
    split.female > split.male ? 'majority female' : split.male > split.female ? 'majority male' : null,
    topLanguage ? `${topLanguage.label.charAt(0).toUpperCase()}${topLanguage.label.slice(1)}-speaking` : null,
  ].filter(Boolean).join(', ')

  return (
    <Card
      title="Influencer demographics"
      caption={summary ? `Primary TikTok panel: ${summary}. These are the influencers themselves, not their audiences.` : undefined}
      action={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="pill">based on {full(total || ageGender.reduce((a, r) => a + r.count, 0))} influencers</span>
          <div className="seg" role="group" aria-label="View">
            <button aria-pressed={view === 'chart'} onClick={() => setView('chart')}>Chart</button>
            <button aria-pressed={view === 'table'} onClick={() => setView('table')}>Table</button>
          </div>
        </div>
      }
    >
      {view === 'chart' ? (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(200px, 0.8fr) minmax(240px, 1.4fr) minmax(200px, 1fr)', gap: 24 }}>
          <div>
            <div className="tile-label">Gender</div>
            <GenderDonut split={split} />
          </div>
          <div>
            <div className="tile-label">Age and gender</div>
            <AgePyramid rows={ageGender} />
          </div>
          <div>
            <div className="tile-label">Languages</div>
            {language.length ? <ShareBars rows={language} /> : <div className="empty">No language data.</div>}
          </div>
        </div>
      ) : (
        <div className="grid two-col">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Age</th><th>Gender</th><th className="num">Influencers</th><th className="num">Share</th></tr></thead>
              <tbody>
                {[...ageGender].sort((a, b) => b.count - a.count).map((r) => (
                  <tr key={r.value}>
                    <td>{r.ageGroup ?? '—'}</td>
                    <td style={{ textTransform: 'capitalize' }}>{r.gender ?? '—'}</td>
                    <td className="num">{full(r.count)}</td>
                    <td className="num">{pct(r.share, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Language</th><th className="num">Influencers</th><th className="num">Share</th></tr></thead>
              <tbody>
                {[...language].sort((a, b) => b.count - a.count).map((r) => (
                  <tr key={r.value}>
                    <td style={{ textTransform: 'capitalize' }}>{r.label}</td>
                    <td className="num">{full(r.count)}</td>
                    <td className="num">{pct(r.share, 2)}</td>
                  </tr>
                ))}
                {language.length === 0 ? <tr><td colSpan={3} className="empty">No language data.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  )
}
