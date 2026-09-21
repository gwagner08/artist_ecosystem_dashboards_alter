import { useState } from 'react'
import type { RosterDiagnostics, RosterEntry } from '@shared/types.ts'
import { updateAccount } from '../api.ts'
import { compact, pct, signedPct, NETWORK_LABEL, networkColor } from '../format.ts'

const slugify = (name: string) =>
  name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

export function Roster({ artists, onOpen, groupName, diagnostics, onChanged }: {
  artists: RosterEntry[]
  onOpen: (slug: string) => void
  groupName: string
  diagnostics?: RosterDiagnostics | null
  onChanged?: () => void
}) {
  const [layout, setLayout] = useState<'grid' | 'table'>('grid')

  if (artists.length === 0) return <EmptyRoster groupName={groupName} diagnostics={diagnostics} />

  return (
    <>
      <div className="filters" style={{ borderBottom: 0, marginBottom: 10 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {artists.length} artists · trailing 90 days
        </span>
        <div className="spacer" />
        <div className="seg" role="group" aria-label="Layout">
          <button aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')}>Grid</button>
          <button aria-pressed={layout === 'table'} onClick={() => setLayout('table')}>Table</button>
        </div>
      </div>

      {diagnostics?.unassigned?.length ? (
        <Unassigned diagnostics={diagnostics} onChanged={onChanged} />
      ) : null}

      <ChartmetricGaps artists={artists} />

      {layout === 'grid' ? (
        <div className="roster-grid">
          {artists.map((a) => <ArtistCard key={a.slug} artist={a} onOpen={onOpen} />)}
        </div>
      ) : (
        <RosterTable artists={artists} onOpen={onOpen} groupName={groupName} />
      )}
    </>
  )
}

function ArtistCard({ artist: a, onOpen }: { artist: RosterEntry; onOpen: (slug: string) => void }) {
  // Initials stand in for a missing photo rather than an empty box.
  const initials = a.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()

  return (
    <button className="artist-card" onClick={() => onOpen(a.slug)} aria-label={`Open ${a.name}`}>
      <div
        className={`artist-photo${a.imageUrl ? '' : ' artist-photo-empty'}`}
        style={a.imageUrl ? { backgroundImage: `url(${JSON.stringify(a.imageUrl)})` } : undefined}
      >
        {a.imageUrl ? null : initials}
      </div>
      <div className="artist-body">
        <span className="artist-name">{a.name}</span>
        <div className="artist-dots">
          {a.networks.map((n) => (
            <span key={n} className="legend-swatch" title={NETWORK_LABEL[n] ?? n}
              style={{ background: networkColor(n) }} />
          ))}
        </div>
        <div className="artist-stats">
          <span><b>{compact(a.followers)}</b> followers</span>
          {a.followerChangePct != null ? (
            <span className={`delta ${a.followerChangePct >= 0 ? 'up' : 'down'}`}>
              {signedPct(a.followerChangePct)}
            </span>
          ) : null}
        </div>
        <div className="artist-stats">
          <span><b>{compact(a.monthlyListeners)}</b> listeners</span>
          {a.upcomingEvents ? <span><b>{a.upcomingEvents}</b> shows</span> : null}
          {a.sellThrough != null ? <span><b>{pct(a.sellThrough, 0)}</b> sold</span> : null}
        </div>
      </div>
    </button>
  )
}

function RosterTable({ artists, onOpen, groupName }: {
  artists: RosterEntry[]; onOpen: (slug: string) => void; groupName: string
}) {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{groupName} roster</h2>
          <p className="caption">
            {artists.length} artists. Trailing 90 days. Select an artist for the full ecosystem.
          </p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Artist</th>
              <th>Networks</th>
              <th className="num">Followers</th>
              <th className="num">Change</th>
              <th className="num">Eng. rate</th>
              <th className="num">Monthly listeners</th>
              <th className="num">Shows</th>
              <th className="num">Sell-through</th>
            </tr>
          </thead>
          <tbody>
            {artists.map((a) => (
              <tr key={a.slug} className="roster-row" onClick={() => onOpen(a.slug)}>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                    <span
                      className="artist-thumb"
                      style={a.imageUrl ? { backgroundImage: `url(${JSON.stringify(a.imageUrl)})` } : undefined}
                    />
                    <button className="linkish" onClick={(e) => { e.stopPropagation(); onOpen(a.slug) }}>
                      {a.name}
                    </button>
                  </span>
                </td>
                <td>
                  <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                    {a.networks.map((n) => (
                      <span key={n} title={NETWORK_LABEL[n] ?? n} className="legend-swatch"
                        style={{ background: networkColor(n) }} />
                    ))}
                    <span className="muted" style={{ fontSize: 11, marginLeft: 2 }}>
                      {a.networks.map((n) => NETWORK_LABEL[n] ?? n).join(', ')}
                    </span>
                  </span>
                </td>
                <td className="num">{compact(a.followers)}</td>
                <td className="num">
                  <span className={`delta ${a.followerChangePct == null ? 'flat' : a.followerChangePct >= 0 ? 'up' : 'down'}`}>
                    {signedPct(a.followerChangePct)}
                  </span>
                </td>
                <td className="num">{pct(a.engagementRate, 2)}</td>
                <td className="num">{compact(a.monthlyListeners)}</td>
                <td className="num">{a.upcomingEvents || '—'}</td>
                <td className="num">{pct(a.sellThrough, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * An empty roster has a small number of causes and the server already knows which
 * one applies, so name it rather than sending everyone to the docs.
 */
function EmptyRoster({ groupName, diagnostics }: { groupName: string; diagnostics?: RosterDiagnostics | null }) {
  const d = diagnostics
  const skipped = Object.entries(d?.skippedNetworks ?? {})

  return (
    <div className="card">
      <h2>No artists in {groupName}</h2>
      {!d ? (
        <p className="caption">
          Check <code>SPROUT_GROUP_ID</code>, then run <code>npm run verify:apis</code>.
        </p>
      ) : d.totalProfiles === 0 ? (
        <p className="caption">
          Sprout returned no profiles at all for this customer. Check <code>SPROUT_CUSTOMER_ID</code>,
          and that the token has access to this account.
        </p>
      ) : (
        <>
          <p className="caption">
            Sprout has <strong>{d.totalProfiles}</strong> profiles on this account, and{' '}
            <strong>{d.matchedProfiles}</strong> matched{' '}
            {d.groupIds.length ? <>group {d.groupIds.join(', ')}</> : <>your filter</>}.
          </p>

          {skipped.length > 0 ? (
            <p className="caption">
              Skipped for unrecognised network types: {skipped.map(([n, c]) => `${n} (${c})`).join(', ')}.
            </p>
          ) : null}

          {d.topGroups.length > 0 ? (
            <>
              <p className="caption">
                These groups actually have profiles on them. A parent group often holds none
                directly — set <code>SPROUT_GROUP_ID</code> to the sub-groups instead (it accepts a
                comma-separated list).
              </p>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Group ID</th><th className="num">Profiles</th></tr></thead>
                  <tbody>
                    {d.topGroups.map((g) => (
                      <tr key={g.groupId}>
                        <td>{g.groupId}</td>
                        <td className="num">{g.profiles}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="caption" style={{ marginTop: 14 }}>
                <code>SPROUT_GROUP_ID={d.topGroups.slice(0, 3).map((g) => g.groupId).join(',')}</code>
              </p>
            </>
          ) : null}
        </>
      )}
    </div>
  )
}

/**
 * Accounts in the Sprout group that belong to no artist yet.
 *
 * Assigning here writes a server-side override that beats every matching rule, so
 * it survives restarts and stops the same account needing a config edit. Attaching
 * to "New artist" creates a roster row from that account.
 */
function Unassigned({ diagnostics, onChanged }: {
  diagnostics: RosterDiagnostics
  onChanged?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const rows = diagnostics.unassigned
  const artists = diagnostics.assignableArtists ?? []

  async function assign(profileId: number, profileName: string, value: string) {
    if (!value) return
    setBusy(profileId)
    setError(null)
    try {
      if (value === '__new__') {
        await updateAccount(profileId, { artistSlug: slugify(profileName), artistName: profileName })
      } else {
        await updateAccount(profileId, { artistSlug: value })
      }
      onChanged?.()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="banner">
      <strong>{rows.length} account{rows.length === 1 ? '' : 's'} in {'\u2018'}Mick Management{'\u2019'} belong to no artist</strong>{' '}
      and are excluded from every number.
      {' '}
      <button className="linkish" style={{ textDecoration: 'underline' }} onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide' : 'Assign them'}
      </button>

      {error ? <div style={{ marginTop: 8 }}>Could not save: {error}</div> : null}

      {open ? (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr><th>Account</th><th>Network</th><th>Assign to</th></tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.customerProfileId}>
                  <td>{p.name}</td>
                  <td>
                    <span className="legend-swatch" style={{ background: networkColor(p.network), display: 'inline-block', marginRight: 6 }} />
                    {NETWORK_LABEL[p.network] ?? p.network}
                  </td>
                  <td>
                    <select
                      className="control"
                      defaultValue=""
                      disabled={busy === p.customerProfileId}
                      aria-label={`Assign ${p.name} to an artist`}
                      onChange={(e) => assign(p.customerProfileId, p.name, e.target.value)}
                    >
                      <option value="">Choose…</option>
                      <option value="__new__">New artist: {p.name}</option>
                      {artists.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Artists Chartmetric could not match by name.
 *
 * These are the cards with no photo and no streaming numbers, so name them and offer
 * the near-misses rather than leaving a silent gap. Matching stays exact-only on
 * purpose - picking a close name would attribute another artist's streams.
 */
function ChartmetricGaps({ artists }: { artists: RosterEntry[] }) {
  const [open, setOpen] = useState(false)
  const gaps = artists.filter((a) => a.chartmetricArtistId == null)
  if (gaps.length === 0) return null

  return (
    <div className="banner">
      <strong>{gaps.length} artist{gaps.length === 1 ? '' : 's'} not matched on Chartmetric</strong>{' '}
      — no photo, listeners or listener geography for{' '}
      {gaps.slice(0, 8).map((a) => a.name).join(', ')}
      {gaps.length > 8 ? `, and ${gaps.length - 8} more` : ''}.
      {gaps.some((a) => a.chartmetricCandidates.length > 0) ? (
        <>
          {' '}
          <button className="linkish" style={{ textDecoration: 'underline' }} onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide' : 'Show near matches'}
          </button>
        </>
      ) : null}

      {open ? (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead><tr><th>Artist</th><th>Closest Chartmetric names</th><th>Pin with</th></tr></thead>
            <tbody>
              {gaps.filter((a) => a.chartmetricCandidates.length > 0).map((a) => (
                <tr key={a.slug}>
                  <td>{a.name}</td>
                  <td style={{ whiteSpace: 'normal' }}>
                    {a.chartmetricCandidates.map((c) => `${c.name} (${c.id})`).join(', ')}
                  </td>
                  <td><code>chartmetricArtistId</code></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="caption" style={{ marginTop: 10 }}>
            Add the right ID as <code>chartmetricArtistId</code> for that artist in{' '}
            <code>config/artists.json</code>. Only exact name matches are used automatically,
            so a close name is never assumed.
          </p>
        </div>
      ) : null}
    </div>
  )
}
