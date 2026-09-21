/**
 * Chartmetric API client.
 *
 * Auth is a long-lived refresh token exchanged for a 1-hour access token via
 * POST /api/token. Responses wrap their payload in an `obj` key.
 *
 * NOTE: chartmetric's published docs host was unreachable from this environment,
 * so the response shapes below are defensive - every reader tolerates several
 * plausible key spellings rather than assuming one. `npm run verify:apis` prints
 * the real shape from your account so these can be tightened.
 */
import { config } from '../config.ts'
import { request } from '../http.ts'
import type { ListenerCity, StreamingPoint } from '@shared/types.ts'

let token: { value: string; expiresAt: number } | null = null

async function accessToken(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value
  const res = await request<{ token: string; expires_in?: number }>(
    'chartmetric', `${config.chartmetric.baseUrl}/token`,
    { method: 'POST', body: { refreshtoken: config.chartmetric.refreshToken } },
  )
  token = { value: res.token, expiresAt: Date.now() + (res.expires_in ?? 3600) * 1000 }
  return token.value
}

async function cmGet<T>(path: string): Promise<T> {
  const bearer = await accessToken()
  const res = await request<{ obj: T }>('chartmetric', `${config.chartmetric.baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${bearer}` },
  })
  return res.obj
}

export interface CmArtist {
  id: number
  name: string
  sp_followers?: number
  sp_monthly_listeners?: number
  cm_artist_rank?: number
}

/**
 * Artist search.
 *
 * `type` is PLURAL. The API rejects `type=artist` with a 400 listing the valid
 * values: all, artists, tracks, playlists, curators, albums, stations, cities,
 * songwriters.
 */
export async function searchArtist(query: string): Promise<CmArtist[]> {
  const obj = await cmGet<{ artists?: CmArtist[] } | CmArtist[]>(
    `/search?q=${encodeURIComponent(query)}&type=artists&limit=10`,
  )
  if (Array.isArray(obj)) return obj
  return obj?.artists ?? []
}

/**
 * Fold accents BEFORE stripping non-alphanumerics.
 *
 * Without the fold, an accented character is simply deleted: "The Marias" written
 * with an acute accent became "themaras" while Chartmetric's unaccented spelling
 * became "themarias", so the artist never matched and lost its artwork and
 * streaming data. Same bug as the roster name matcher had.
 */
const normalize = (s: string) =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/** Spellings worth trying when the exact name finds nothing. */
function searchVariants(name: string): string[] {
  const ascii = name.normalize('NFD').replace(/\p{Diacritic}/gu, '')
  const noLeadingThe = name.replace(/^the\s+/i, '')
  const asciiNoThe = ascii.replace(/^the\s+/i, '')
  return [...new Set([name, ascii, noLeadingThe, asciiNoThe].filter(Boolean))]
}

export interface ArtistMatch {
  artistId: number | null
  matchedBy: 'name' | null
  /** Populated when nothing matched confidently, so a human can pick. */
  candidates: CmArtist[]
}

/**
 * Resolve an artist name to a Chartmetric ID.
 *
 * Only an exact name match (ignoring case and punctuation) is used automatically.
 * A fuzzy top-result match would silently attribute another artist's streams to
 * yours, which is worse than showing nothing - so anything less than exact returns
 * candidates for a human to pin in config/artists.json instead.
 *
 * When several artists share a name, the most prominent wins: Chartmetric's rank
 * where present, otherwise Spotify listeners.
 */
export async function resolveArtist(name: string): Promise<ArtistMatch> {
  const target = normalize(name)
  const seen: CmArtist[] = []

  // Try the name as written, then plainer spellings, stopping at the first exact hit.
  for (const variant of searchVariants(name)) {
    const results = await searchArtist(variant)
    for (const r of results) if (!seen.some((s) => s.id === r.id)) seen.push(r)

    const exact = results.filter((a) => normalize(a.name) === target)
    if (exact.length > 0) {
      const best = [...exact].sort((a, b) => {
        if (a.cm_artist_rank != null && b.cm_artist_rank != null) return a.cm_artist_rank - b.cm_artist_rank
        return (b.sp_monthly_listeners ?? b.sp_followers ?? 0) - (a.sp_monthly_listeners ?? a.sp_followers ?? 0)
      })[0]!
      return { artistId: best.id, matchedBy: 'name', candidates: exact.length > 1 ? exact.slice(0, 5) : [] }
    }
  }

  return { artistId: null, matchedBy: null, candidates: seen.slice(0, 5) }
}

export interface CmArtistMeta {
  id: number
  name: string
  /** Main profile photo. */
  imageUrl: string | null
  /** Wide banner image. */
  coverUrl: string | null
}

/**
 * Artist metadata, including the artwork the dashboard leads with.
 * Returns null rather than throwing - a missing photo must never take a row down.
 */
export async function getArtist(artistId: number): Promise<CmArtistMeta | null> {
  try {
    const obj = await cmGet<Record<string, unknown>>(`/artist/${artistId}`)
    if (!obj) return null
    return {
      id: Number(obj.id ?? artistId),
      name: String(obj.name ?? ''),
      imageUrl: (obj.image_url as string) ?? null,
      coverUrl: (obj.cover_url as string) ?? null,
    }
  } catch {
    return null
  }
}

type RawPoint = { timestp?: string; timestamp?: string; date?: string; value?: number; count?: number }

function toSeries(points: RawPoint[] | undefined): Map<string, number> {
  const out = new Map<string, number>()
  for (const p of points ?? []) {
    const date = (p.timestp ?? p.timestamp ?? p.date ?? '').slice(0, 10)
    const value = p.value ?? p.count
    if (date.length === 10 && typeof value === 'number') out.set(date, value)
  }
  return out
}

/**
 * Spotify listener / follower / popularity history, merged onto one date axis.
 * `/artist/:id/stat/spotify` returns parallel arrays keyed by metric.
 */
export async function fetchSpotifyStats(artistId: number, from: string, to: string): Promise<StreamingPoint[]> {
  const obj = await cmGet<Record<string, RawPoint[]>>(
    `/artist/${artistId}/stat/spotify?since=${from}&until=${to}`,
  )
  const listeners = toSeries(obj?.listeners ?? obj?.monthly_listeners)
  const followers = toSeries(obj?.followers)
  const popularity = toSeries(obj?.popularity)

  const dates = [...new Set([...listeners.keys(), ...followers.keys(), ...popularity.keys()])].sort()
  return dates.map((date) => ({
    date,
    spotifyListeners: listeners.get(date) ?? null,
    spotifyFollowers: followers.get(date) ?? null,
    spotifyPopularity: popularity.get(date) ?? null,
  }))
}

/**
 * A row inside where-people-listen.
 *
 * Note there is NO city field: the city name is the KEY of the `cities` map. Reading
 * it off the row produced undefined, every row was filtered out, and the panel
 * rendered "No markets in this range" while the API was returning data.
 */
interface RawCity {
  timestp?: string
  code2?: string
  lat?: number
  lng?: number
  region?: string
  listeners?: number
  prev_listeners?: number
  artist_city_rank?: number
  is_estimate?: boolean
}

/**
 * Top listener cities - the geography we join against ticket sales.
 *
 * `latest=true` returns one snapshot per city instead of 180 days of time series:
 * what this panel needs, and a far smaller response.
 *
 * Since August 2024 Spotify supplies only estimates at city level and Chartmetric
 * models the gaps. Good enough to rank markets against ticket sales; not a number
 * to quote as fact.
 */
export async function fetchListenerCities(artistId: number, limit = 50): Promise<ListenerCity[]> {
  const obj = await cmGet<{ cities?: Record<string, RawCity[]> | RawCity[] }>(
    `/artist/${artistId}/where-people-listen?latest=true&limit=${limit}`,
  )
  const raw = obj?.cities
  if (!raw) return []

  // Keyed by city name; the older flat-array shape is still tolerated.
  const entries: Array<{ city: string; row: RawCity }> = Array.isArray(raw)
    ? []
    : Object.entries(raw).flatMap(([city, snapshots]) =>
        (snapshots ?? []).map((row) => ({ city, row })),
      )

  // With latest=true there is one row per city; keep the newest if several arrive.
  const newest = new Map<string, { city: string; row: RawCity }>()
  for (const entry of entries) {
    if (!entry.city) continue
    const existing = newest.get(entry.city)
    if (!existing || (entry.row.timestp ?? '') > (existing.row.timestp ?? '')) {
      newest.set(entry.city, entry)
    }
  }

  return [...newest.values()]
    .map(({ city, row }) => ({
      city,
      region: null,
      country: row.code2 ?? '',
      listeners: row.listeners ?? 0,
      latitude: row.lat ?? null,
      longitude: row.lng ?? null,
    }))
    .filter((c) => c.city && c.listeners > 0)
    .sort((a, b) => b.listeners - a.listeners)
}

/**
 * Latest headline stats in one cheap call.
 *
 * The daily stat series does not always carry a listeners value on its most recent
 * date - the date axis is the union of listeners, followers and popularity - so the
 * headline number needs an authoritative source rather than "the last row".
 */
export interface CmLatestStats {
  monthlyListeners: number | null
  followers: number | null
  popularity: number | null
  weeklyListenerChange: number | null
}

export async function fetchLatestStats(artistId: number): Promise<CmLatestStats | null> {
  try {
    const obj = await cmGet<{ latest?: Record<string, number>; weekly_diff?: Record<string, number> }>(
      `/artist/${artistId}/cmStats`,
    )
    if (!obj?.latest) return null
    return {
      monthlyListeners: obj.latest.sp_monthly_listeners ?? null,
      followers: obj.latest.sp_followers ?? null,
      popularity: obj.latest.sp_popularity ?? null,
      weeklyListenerChange: obj.weekly_diff?.sp_monthly_listeners ?? null,
    }
  } catch {
    return null
  }
}

/* ==========================================================================
 * UGC — what creators are doing with the artist's music.
 *
 * These are premium endpoints. A plan without them answers 403, so every
 * reader here degrades to null or an empty list rather than throwing: a missing
 * UGC panel must never take an artist page down with it.
 * ========================================================================== */

export type UgcSource = 'tiktok' | 'youtubeforartist' | 'cm'

export interface UgcTrackRaw {
  tiktok?: string
  youtube?: string
  name?: string
  isrc?: string
  cm_track?: number
  views?: number
  likes?: number
  comments?: number
  posts?: number
  score?: number
  engagementRate?: number
}

/** Top UGC sounds for an artist on one platform. */
export async function fetchTopUgcTracks(
  artistId: number,
  source: UgcSource = 'tiktok',
  limit = 20,
): Promise<UgcTrackRaw[]> {
  try {
    const obj = await cmGet<UgcTrackRaw[] | { data?: UgcTrackRaw[] }>(
      `/artist/${artistId}/top-tracks/${source}?limit=${limit}`,
    )
    if (Array.isArray(obj)) return obj
    return obj?.data ?? []
  } catch {
    return []
  }
}

export type CreatorDimension = 'country' | 'age-gender' | 'category' | 'subcategory' | 'language'

export interface CreatorBreakdownRow {
  value: string
  ageGroup: string | null
  gender: string | null
  count: number
  share: number
  /** Change in creator count against the previous period. */
  delta: number | null
}

export interface CreatorBreakdown {
  dimension: CreatorDimension
  periodDays: number
  total: number
  rows: CreatorBreakdownRow[]
}

/** Aggregated stats on the creators using an artist's sounds. */
export async function fetchCreatorBreakdown(
  artistId: number,
  dimension: CreatorDimension = 'country',
  periodDays = 30,
): Promise<CreatorBreakdown | null> {
  try {
    const obj = await cmGet<{
      dimension?: string
      period_days?: number
      total?: number
      data?: Array<Record<string, unknown>>
    }>(`/artist/${artistId}/tiktok-influencer-stats?dimension=${dimension}&periodDays=${periodDays}`)
    if (!obj?.data) return null

    return {
      dimension,
      periodDays: obj.period_days ?? periodDays,
      total: obj.total ?? 0,
      rows: obj.data.map((r) => ({
        value: String(r.value ?? ''),
        ageGroup: (r.age_group as string) ?? null,
        gender: (r.gender as string) ?? null,
        count: Number(r.count ?? 0),
        share: Number(r.share ?? 0),
        delta: r.delta == null ? null : Number(r.delta),
      })).filter((r) => r.value),
    }
  } catch {
    return null
  }
}

export interface UgcCreatorRaw {
  handle?: string
  full_name?: string
  followers?: number
  is_verified?: boolean
  country?: string
  age_group?: string
  gender?: string
  categories?: string[]
  engagement_rate?: number
  avg_views?: number
  avg_likes?: number
  avg_comments?: number
  video_count?: number
  featured_track?: string
}

/** The actual creators making content with the artist's sounds. */
export async function fetchTopCreators(
  artistId: number,
  options: { limit?: number; minFollowers?: number; sortBy?: string } = {},
): Promise<UgcCreatorRaw[]> {
  const { limit = 25, minFollowers, sortBy = 'totalFollowers' } = options
  const q = new URLSearchParams({ sortBy, limit: String(limit) })
  if (minFollowers != null) q.set('minFollowers', String(minFollowers))

  try {
    const obj = await cmGet<{ data?: UgcCreatorRaw[] } | UgcCreatorRaw[]>(
      `/artist/${artistId}/tiktok-top-influencers?${q}`,
    )
    if (Array.isArray(obj)) return obj
    return obj?.data ?? []
  } catch {
    return []
  }
}

export type VideoSort = 'likes' | 'views' | 'comments' | 'shares' | 'saves' | 'created_at' | 'trending'

export interface UgcVideoRaw {
  video_id?: string
  username?: string
  link?: string
  created_at?: string
  video_title?: string
  followers?: number
  stats?: { views?: number; likes?: number; comments?: number; shares?: number; saves?: number }
  views?: number
  likes?: number
  comments?: number
  viewsPercentChange?: number
  likesPercentChange?: number
}

/**
 * Top TikTok videos using one track's sound.
 * `byTiktokId` treats the id as a TikTok sound id rather than a Chartmetric track id.
 */
export async function fetchTrackTopVideos(
  trackId: string | number,
  options: {
    type?: VideoSort
    limit?: number
    byTiktokId?: boolean
    /** Only videos POSTED within this many days. */
    postedWithinDaysAgo?: number
    /** Window the percent-change figures compare against. Defaults to 28. */
    fromDaysAgo?: number
  } = {},
): Promise<UgcVideoRaw[]> {
  const { type = 'views', limit = 24, byTiktokId = false, postedWithinDaysAgo, fromDaysAgo } = options
  const q = new URLSearchParams({ type, limit: String(limit) })
  if (byTiktokId) q.set('byTiktokId', 'true')
  if (postedWithinDaysAgo != null) q.set('postedWithinDaysAgo', String(clampDays(postedWithinDaysAgo)))
  if (fromDaysAgo != null) q.set('fromDaysAgo', String(clampDays(fromDaysAgo)))

  try {
    const obj = await cmGet<UgcVideoRaw[] | { data?: UgcVideoRaw[] }>(
      `/track/${encodeURIComponent(String(trackId))}/topVideos?${q}`,
    )
    if (Array.isArray(obj)) return obj
    return obj?.data ?? []
  } catch {
    return []
  }
}

/** Top YouTube Shorts using one track. Shape differs: rows sit under obj.data. */
/**
 * Top YouTube Shorts using one track.
 *
 * Shorts have NO server-side date filter. So when a window is asked for, pull by
 * recency with a wide limit, cut to the window, then re-sort by the metric the
 * caller wanted. Sorting server-side first and filtering after would return the
 * all-time top videos and then discard nearly all of them.
 */
export async function fetchTrackTopShorts(
  trackId: string | number,
  options: {
    type?: 'likes' | 'views' | 'comments' | 'trending' | 'created_at'
    limit?: number
    bySoundId?: boolean
    postedWithinDaysAgo?: number
  } = {},
): Promise<{ total: number | null; videos: UgcVideoRaw[] }> {
  const { type = 'views', limit = 24, bySoundId = false, postedWithinDaysAgo } = options
  const windowed = postedWithinDaysAgo != null

  const q = new URLSearchParams({
    type: windowed ? 'created_at' : type,
    limit: String(windowed ? 100 : limit),
  })
  if (bySoundId) q.set('bySoundId', 'true')

  try {
    const obj = await cmGet<{ total?: number; data?: UgcVideoRaw[] } | UgcVideoRaw[]>(
      `/track/youtube/${encodeURIComponent(String(trackId))}/topShorts?${q}`,
    )
    const total = Array.isArray(obj) ? null : obj?.total ?? null
    let videos = Array.isArray(obj) ? obj : obj?.data ?? []

    if (windowed) {
      const cutoff = Date.now() - clampDays(postedWithinDaysAgo) * 86_400_000
      videos = videos
        .filter((v) => {
          const t = v.created_at ? Date.parse(v.created_at) : NaN
          return Number.isNaN(t) ? false : t >= cutoff
        })
        .sort((a, b) => metricOf(b, type) - metricOf(a, type))
        .slice(0, limit)
    }

    return { total, videos }
  } catch {
    return { total: null, videos: [] }
  }
}

function metricOf(v: UgcVideoRaw, type: string): number {
  if (type === 'created_at' || type === 'trending') return Date.parse(v.created_at ?? '') || 0
  if (type === 'likes') return v.stats?.likes ?? v.likes ?? 0
  if (type === 'comments') return v.stats?.comments ?? v.comments ?? 0
  return v.stats?.views ?? v.views ?? 0
}

/** The API accepts 0-365 days. */
function clampDays(days: number): number {
  return Math.max(1, Math.min(Math.round(days), 365))
}

/**
 * Top videos across ALL of an artist's sounds, rather than one track.
 * This is what makes the UGC tab respond to the date range: sounds themselves
 * have no date filter, but the videos made with them do.
 */
export async function fetchArtistTopVideos(
  artistId: number,
  options: { type?: VideoSort; limit?: number; postedWithinDaysAgo?: number } = {},
): Promise<UgcVideoRaw[]> {
  const { type = 'views', limit = 24, postedWithinDaysAgo } = options
  const q = new URLSearchParams({ type, limit: String(limit) })
  if (postedWithinDaysAgo != null) q.set('postedWithinDaysAgo', String(clampDays(postedWithinDaysAgo)))

  try {
    const obj = await cmGet<UgcVideoRaw[] | { data?: UgcVideoRaw[] }>(
      `/artist/${artistId}/tiktok-top-videos?${q}`,
    )
    if (Array.isArray(obj)) return obj
    return obj?.data ?? []
  } catch {
    return []
  }
}
