import { useMemo, useState } from 'react'
import type { SocialPost } from '@shared/types.ts'
import { compact, pct, shortDate, NETWORK_LABEL, networkColor } from '../format.ts'

type SortKey = 'published' | 'views' | 'likes' | 'comments' | 'shares' | 'engagementRate'

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'published', label: 'Published' },
  { key: 'views', label: 'Views' },
  { key: 'likes', label: 'Likes' },
  { key: 'comments', label: 'Comments' },
  { key: 'shares', label: 'Shares' },
  { key: 'engagementRate', label: 'Engagement rate' },
]

const NET_ABBR: Record<string, string> = {
  instagram: 'IG', tiktok: 'TT', youtube: 'YT', facebook: 'FB',
  twitter: 'X', threads: 'TH', linkedin: 'LI', pinterest: 'PIN', bluesky: 'BS',
}

function daysAgo(iso: string): string {
  if (!iso) return '—'
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (d < 0) return 'scheduled'
  if (d === 0) return 'today'
  return `${d} day${d === 1 ? '' : 's'} ago`
}

export function Posts({ posts }: { posts: SocialPost[] }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('published')
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? posts.filter((p) =>
          p.text.toLowerCase().includes(q) ||
          p.accountName.toLowerCase().includes(q) ||
          (p.accountHandle ?? '').toLowerCase().includes(q))
      : posts

    const value = (p: SocialPost): number => {
      switch (sort) {
        case 'views': return p.views ?? p.videoViews ?? 0
        case 'likes': return p.likes ?? 0
        case 'comments': return p.comments ?? 0
        case 'shares': return p.shares ?? 0
        case 'engagementRate': return p.engagementRate ?? 0
        default: return 0
      }
    }
    return [...filtered].sort((a, b) =>
      sort === 'published' ? b.createdAt.localeCompare(a.createdAt) : value(b) - value(a))
  }, [posts, query, sort])

  return (
    <>
      <div className="filters" style={{ borderBottom: 0, marginBottom: 8 }}>
        <input
          className="search" type="search" placeholder="Search captions and accounts…"
          value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search posts"
        />
        <label htmlFor="post-sort">Sort by</label>
        <select id="post-sort" className="control" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <div className="spacer" />
        <span className="muted" style={{ fontSize: 12 }}>{visible.length} posts</span>
        <div className="seg" role="group" aria-label="Layout">
          <button aria-pressed={layout === 'list'} onClick={() => setLayout('list')}>List</button>
          <button aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')}>Grid</button>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="card"><div className="empty">
          {posts.length === 0
            ? 'No posts from the selected accounts in this range.'
            : 'No posts match that search.'}
        </div></div>
      ) : layout === 'grid' ? (
        <div className="posts-grid">
          {visible.map((p) => <PostCard key={p.id} post={p} />)}
        </div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Published</th><th>Account</th><th>Post</th>
                  <th className="num">Views</th><th className="num">Likes</th>
                  <th className="num">Comments</th><th className="num">Shares</th>
                  <th className="num">Eng. rate</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.id}>
                    <td>{p.createdAt ? shortDate(p.createdAt.slice(0, 10)) : '—'}</td>
                    <td>
                      <span className="legend-swatch" style={{ background: networkColor(p.network), display: 'inline-block', marginRight: 6 }} />
                      {p.accountHandle ? `@${p.accountHandle}` : p.accountName}
                      {p.accountType === 'fan' ? <span className="reason"> · fan</span> : null}
                    </td>
                    <td style={{ maxWidth: 340, whiteSpace: 'normal' }}>{p.text.slice(0, 90) || '(no caption)'}</td>
                    <td className="num">{compact(p.views ?? p.videoViews)}</td>
                    <td className="num">{compact(p.likes)}</td>
                    <td className="num">{compact(p.comments)}</td>
                    <td className="num">{compact(p.shares)}</td>
                    <td className="num"
                      title={p.engagementRateBasis
                        ? `engagements ÷ ${p.engagementRateBasis === 'reach' ? 'reach (unique viewers)' : p.engagementRateBasis}`
                        : undefined}>
                      {pct(p.engagementRate, 2)}
                      {p.engagementRateBasis && p.engagementRateBasis !== 'reach' ? (
                        <span className="reason"> {p.engagementRateBasis === 'views' ? 'v' : 'i'}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}

function PostCard({ post: p }: { post: SocialPost }) {
  const body = (
    <>
      <div className="post-thumb" style={p.thumbnailUrl ? { backgroundImage: `url(${JSON.stringify(p.thumbnailUrl)})` } : undefined}>
        <div className="post-badges">
          <span className="net-badge" style={{ background: networkColor(p.network) }}
            title={NETWORK_LABEL[p.network] ?? p.network}>
            {NET_ABBR[p.network] ?? '•'}
          </span>
          {p.accountType === 'fan' ? (
            <span className="pill" style={{ background: 'var(--surface-1)' }}>fan</span>
          ) : null}
        </div>
        <span className="post-age">{daysAgo(p.createdAt)}</span>
      </div>
      <div className="post-body">
        <span className="post-handle">
          {p.accountHandle ? `@${p.accountHandle}` : p.accountName}
        </span>
        <div className="post-metrics">
          <span><b>{compact(p.views ?? p.videoViews)}</b> views</span>
          <span><b>{compact(p.likes)}</b> likes</span>
          <span><b>{compact(p.comments)}</b> comments</span>
          <span><b>{compact(p.shares)}</b> shares</span>
        </div>
        <div className="post-metrics">
          <span title={p.engagementRateBasis
            ? `engagements ÷ ${p.engagementRateBasis === 'reach' ? 'reach (unique viewers)' : p.engagementRateBasis}`
            : undefined}>
            <b>{pct(p.engagementRate, 2)}</b> eng. rate
            {p.engagementRateBasis ? <span className="reason"> vs {p.engagementRateBasis}</span> : null}
          </span>
        </div>
        <p className="post-text">{p.text || '(no caption)'}</p>
      </div>
    </>
  )

  return p.permalink ? (
    <a className="post-card" href={p.permalink} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
      {body}
    </a>
  ) : (
    <div className="post-card">{body}</div>
  )
}
