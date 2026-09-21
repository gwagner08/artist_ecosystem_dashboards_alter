import { useEffect, useState } from 'react'
import type {
  AccountFilter, ArtistEcosystem, NetworkFilter, ProviderStatus, RosterDiagnostics, RosterEntry,
} from '@shared/types.ts'
import { getArtist, getRoster } from './api.ts'
import { Roster } from './views/Roster.tsx'
import { ArtistDetail } from './views/ArtistDetail.tsx'
import { Posts } from './views/Posts.tsx'
import { Live } from './views/Live.tsx'
import { Ugc } from './views/Ugc.tsx'
import { Accounts } from './views/Accounts.tsx'
import { ProviderBanner } from './components/Banner.tsx'
import { BrandLogo } from './components/BrandLogo.tsx'
import { NETWORK_LABEL } from './format.ts'

type Tab = 'overview' | 'posts' | 'ugc' | 'live' | 'accounts'

const ACCOUNT_TABS: Array<{ key: AccountFilter; label: string }> = [
  { key: 'all', label: 'All accounts' },
  { key: 'artist', label: 'Artist-owned' },
  { key: 'fan', label: 'Fan accounts' },
]

const PRESETS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '1y', days: 364 },
]

const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)

export default function App() {
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [groupName, setGroupName] = useState('Alter Music')
  const [diagnostics, setDiagnostics] = useState<RosterDiagnostics | null>(null)
  const [slug, setSlug] = useState<string | null>(null)
  const [days, setDays] = useState(90)
  const [tab, setTab] = useState<Tab>('overview')
  const [accountType, setAccountType] = useState<AccountFilter>('all')
  const [network, setNetwork] = useState<NetworkFilter>('all')
  const [reloadKey, setReloadKey] = useState(0)
  const [rosterKey, setRosterKey] = useState(0)
  const [data, setData] = useState<ArtistEcosystem | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system')

  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // 'system' has to be resolved against the OS, and tracked while it changes.
  const [systemDark, setSystemDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  const resolvedDark = theme === 'dark' || (theme === 'system' && systemDark)

  useEffect(() => {
    getRoster()
      .then((r) => {
        setRoster(r.artists)
        setProviders(r.providers)
        setDiagnostics(r.diagnostics ?? null)
        const sprout = r.providers.find((p) => p.provider === 'sprout')
        if (sprout) setGroupName(sprout.detail.match(/\(([^)]+)\)/)?.[1] ?? 'Alter Music')
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [rosterKey])

  useEffect(() => {
    if (!slug) { setData(null); return }
    setLoading(true)
    setError(null)
    getArtist(slug, daysAgo(days), today(), accountType, network)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [slug, days, accountType, network, reloadKey])

  // Leaving an artist resets the per-artist filters, so the next one opens clean.
  function openArtist(next: string | null) {
    setSlug(next)
    setTab('overview')
    setAccountType('all')
    setNetwork('all')
  }

  const current = roster.find((a) => a.slug === slug)

  return (
    <div className="app">
      <div className="masthead">
        <BrandLogo dark={resolvedDark} />
        <div className="topbar">
          <h1>Artist Ecosystem</h1>
          <span className="sub">
            {slug ? current?.name ?? slug : groupName}
          </span>
        </div>
        <div className="seg" role="group" aria-label="Theme">
          {(['system', 'light', 'dark'] as const).map((t) => (
            <button key={t} aria-pressed={theme === t} onClick={() => setTheme(t)}>{t}</button>
          ))}
        </div>
      </div>

      {slug ? (
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'overview'} onClick={() => setTab('overview')}>Overview</button>
          <button role="tab" aria-selected={tab === 'posts'} onClick={() => setTab('posts')}>
            Posts{data ? <span className="tab-count">{data.social.posts.length}</span> : null}
          </button>
          <button role="tab" aria-selected={tab === 'ugc'} onClick={() => setTab('ugc')}>
            UGC{data?.ugc?.sounds.length ? <span className="tab-count">{data.ugc.sounds.length}</span> : null}
          </button>
          <button role="tab" aria-selected={tab === 'live'} onClick={() => setTab('live')}>
            Live{data ? <span className="tab-count">{data.live.events.length}</span> : null}
          </button>
          <button role="tab" aria-selected={tab === 'accounts'} onClick={() => setTab('accounts')}>
            Accounts{data ? <span className="tab-count">{data.artist.profiles.length}</span> : null}
          </button>
        </div>
      ) : null}

      <div className="filters">
        {slug ? (
          <button className="control" onClick={() => openArtist(null)}>← Roster</button>
        ) : null}

        <label htmlFor="artist-select">Artist</label>
        <select id="artist-select" className="control" value={slug ?? ''} onChange={(e) => openArtist(e.target.value || null)}>
          <option value="">All artists</option>
          {roster.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
        </select>

        {slug && tab !== 'accounts' && tab !== 'live' && tab !== 'ugc' ? (
          <>
            {/* Platform filter, then account type - both scope everything below. */}
            <div className="seg" role="group" aria-label="Platform">
              <button aria-pressed={network === 'all'} onClick={() => setNetwork('all')}>All</button>
              {(data?.availableNetworks ?? []).map((n) => (
                <button key={n} aria-pressed={network === n} onClick={() => setNetwork(n)}>
                  {NETWORK_LABEL[n] ?? n}
                </button>
              ))}
            </div>

            <div className="seg" role="group" aria-label="Account type">
              {ACCOUNT_TABS.map((t) => {
                const count = data?.accountCounts[t.key === 'all' ? 'all' : t.key] ?? null
                return (
                  <button
                    key={t.key} aria-pressed={accountType === t.key}
                    disabled={count === 0}
                    title={count === 0 ? `No ${t.label.toLowerCase()} for this artist` : undefined}
                    onClick={() => setAccountType(t.key)}
                  >
                    {t.label}{count != null ? <span className="tab-count">{count}</span> : null}
                  </button>
                )
              })}
            </div>

          </>
        ) : null}

        {slug && tab !== 'accounts' ? (
          <>
            <label htmlFor="range">Range</label>
            <div className="seg" id="range" role="group" aria-label="Date range">
              {PRESETS.map((p) => (
                <button key={p.label} aria-pressed={days === p.days} onClick={() => setDays(p.days)}>{p.label}</button>
              ))}
            </div>
          </>
        ) : null}

        <div className="spacer" />
        {data && tab !== 'accounts' ? (
          <span className="muted" style={{ fontSize: 12 }}>{data.range.from} → {data.range.to}</span>
        ) : null}
      </div>

      <ProviderBanner providers={providers} warnings={data?.warnings ?? []} />

      {error ? (
        <div className="card"><div className="empty">{error}</div></div>
      ) : null}

      {/* Refetch keeps the frame: hold the previous render at reduced opacity. */}
      <div className={loading ? 'loading' : undefined}>
        {slug && data ? (
          tab === 'posts' ? <Posts posts={data.social.posts} />
          : tab === 'ugc' ? <Ugc data={data} />
          : tab === 'live' ? <Live data={data} />
          : tab === 'accounts' ? <Accounts data={data} onChanged={() => setReloadKey((k) => k + 1)} />
          : <ArtistDetail data={data} />
        ) : !slug ? (
          <Roster artists={roster} onOpen={openArtist} groupName={groupName} diagnostics={diagnostics}
            onChanged={() => setRosterKey((k) => k + 1)} />
        ) : loading ? null : (
          <div className="card"><div className="empty">No data for this artist.</div></div>
        )}
      </div>
    </div>
  )
}
