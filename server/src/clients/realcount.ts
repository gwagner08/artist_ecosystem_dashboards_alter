/**
 * RealCount API v2 client (box office / ticket counts).
 *
 * Base:  https://realcount.pro
 * Auth:  x-client-id + x-client-secret headers
 *        (credentials from https://realcount.pro/settings/account)
 *
 * Endpoints used:
 *   GET /api/v2/artists/search   ?name= | ?spotify_id= | ?external_id=
 *   GET /api/v2/events           ?artist= &upcoming= &updated_since= &cursor= &limit=
 *   GET /api/v2/counts/{event_id} ?cursor= &limit=          (newest first)
 *   GET /api/v2/events/stats     aggregate totals, avoids paging /events
 *
 * The event object already carries capacity, total_count, total_gross and
 * percent_sold, so listing events is enough for every headline number. The counts
 * endpoint is only needed for sales velocity, and is called for a bounded subset.
 */
import { config } from '../config.ts'
import { request } from '../http.ts'
import type { LiveEvent } from '@shared/types.ts'

const BASE = () => config.realcount.baseUrl
const AUTH = () => ({
  'x-client-id': config.realcount.clientId ?? '',
  'x-client-secret': config.realcount.clientSecret ?? '',
})

interface Cursored<T> {
  data: T[] | { items: T[] }
  meta?: { limit?: number; has_more?: boolean; next_cursor?: string | null }
}

/** Both list shapes appear in the spec: a bare array, and `{ items: [...] }`. */
function rows<T>(payload: Cursored<T>): T[] {
  const d = payload?.data
  if (Array.isArray(d)) return d
  return (d as { items?: T[] })?.items ?? []
}

/** Walks keyset pagination until exhausted or `maxPages` is hit. */
async function paginate<T>(path: string, params: Record<string, string | number | boolean | undefined>, maxPages = 20): Promise<T[]> {
  const out: T[] = []
  let cursor: string | undefined
  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v))
    if (cursor) qs.set('cursor', cursor)

    const res = await request<Cursored<T>>('realcount', `${BASE()}${path}?${qs}`, { headers: AUTH() })
    out.push(...rows(res))
    if (!res.meta?.has_more || !res.meta?.next_cursor) break
    cursor = res.meta.next_cursor
  }
  return out
}

export interface RealCountArtist {
  id: string
  name: string
  spotify_id?: string | null
  external_ids?: string[]
}

/**
 * Resolve a RealCount artist. Prefer spotify_id - it is an exact key, whereas names
 * drift between the booking name and how Sprout labels the profile.
 */
export async function searchArtists(query: { name?: string; spotifyId?: string; externalId?: string }): Promise<RealCountArtist[]> {
  return paginate<RealCountArtist>('/api/v2/artists/search', {
    name: query.name,
    spotify_id: query.spotifyId,
    external_id: query.externalId,
    limit: 25,
  }, 2)
}

interface RawEvent {
  id: string
  artist_ids?: string | string[]
  artist_names?: string | string[]
  booking_name?: string
  venue_name?: string
  venue_id?: string
  city?: string
  region?: string
  region_code?: string
  country?: string
  country_code?: string
  google_places_lat?: number
  google_places_long?: number
  capacity?: number
  legal_capacity?: number
  performance_date?: string
  onsale_date?: string
  currency_code?: string
  total_count?: number
  total_comps?: number
  total_holds?: number
  effective_comps?: number
  effective_holds?: number
  percent_sold?: number
  sold_out?: boolean
  cancelled?: boolean
  is_archived?: boolean
  is_final?: boolean
  latest_count_timestamp?: string
  external_ticket_link?: string
}

export interface RealCountCount {
  id: string
  date: string
  tickets_sold?: number
  holds?: number
  comps?: number
  capacity?: number
  scale_id?: string | null
  is_subcount?: boolean
  is_final?: boolean
}

/** `artist_ids` / `artist_names` come back as a string or an array depending on the row. */
function toList(v: string | string[] | undefined): string[] {
  if (Array.isArray(v)) return v
  if (!v) return []
  return v.split(',').map((s) => s.trim()).filter(Boolean)
}

/**
 * Events for one artist. RealCount filters events by artist NAME (partial,
 * case-insensitive) - there is no artist_id filter - so when we know the UUID we
 * use it to drop partial-name collisions from the result.
 */
export interface FetchEventsOptions {
  /**
   * Sales velocity costs one request per upcoming event. The roster does not show
   * it, so it can be skipped there - that is the difference between one request per
   * artist and thirty.
   */
  includeVelocity?: boolean
}

export async function fetchEvents(
  artistName: string,
  from: string,
  to: string,
  artistId?: string | null,
  options: FetchEventsOptions = {},
): Promise<LiveEvent[]> {
  /*
   * /api/v2/events returns performance_date ASCENDING and offers no date filter, so
   * paging it plainly walks an artist's history from their earliest show forward. On
   * a catalogue account that is thousands of events deep, and the shows anyone cares
   * about are at the far end - a page cap would silently cut off the current tour.
   *
   * So ask for the two slices that matter instead:
   *   upcoming=true       every future show, always a small set
   *   updated_since=from  shows counted inside the window, which covers recent past
   *
   * Merged and de-duplicated. If both come back empty the account may simply have no
   * recent activity, so fall back to plain pagination rather than reporting nothing.
   */
  const [upcomingRaw, recentRaw] = await Promise.all([
    paginate<RawEvent>('/api/v2/events', { artist: artistName, upcoming: true, limit: 100 }, 5),
    paginate<RawEvent>('/api/v2/events', { artist: artistName, updated_since: `${from}T00:00:00Z`, limit: 100 }, 10),
  ])

  const byId = new Map<string, RawEvent>()
  for (const e of [...upcomingRaw, ...recentRaw]) if (e?.id) byId.set(e.id, e)

  let raw = [...byId.values()]
  if (raw.length === 0) {
    raw = await paginate<RawEvent>('/api/v2/events', { artist: artistName, limit: 100 }, 20)
  }

  const matching = raw.filter((e) => {
    if (e.cancelled || e.is_archived) return false
    if (artistId && toList(e.artist_ids).length > 0 && !toList(e.artist_ids).includes(artistId)) return false
    const date = (e.performance_date ?? '').slice(0, 10)
    return date >= from && date <= to
  })

  // Velocity needs count history, which is one request per event. Bound it: only
  // upcoming shows, newest first, with limited concurrency.
  const needVelocity = options.includeVelocity === false ? [] : matching
    .filter((e) => (e.performance_date ?? '').slice(0, 10) >= new Date().toISOString().slice(0, 10))
    .slice(0, 30)
  const velocity = new Map<string, number>()
  await mapLimit(needVelocity, 5, async (e) => {
    try {
      velocity.set(e.id, await last7DaysSold(e.id))
    } catch {
      // A missing count history must not drop the event from the view.
    }
  })

  return matching
    .map((e) => mapEvent(e, velocity.get(e.id) ?? 0))
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate))
}

/**
 * Tickets sold in the trailing 7 days, from the count history.
 * Counts are returned newest first. Sub-counts are per-scale rows: including them
 * would double-count against the event-level row.
 */
async function last7DaysSold(eventId: string): Promise<number> {
  const counts = await paginate<RealCountCount>(`/api/v2/counts/${encodeURIComponent(eventId)}`, { limit: 200 }, 2)
  const eventLevel = counts
    .filter((c) => !c.is_subcount && c.date)
    .sort((a, b) => b.date.localeCompare(a.date))

  const latest = eventLevel[0]
  if (!latest) return 0
  const cutoff = new Date(new Date(latest.date).getTime() - 7 * 86_400_000).toISOString().slice(0, 10)
  const prior = eventLevel.find((c) => c.date.slice(0, 10) <= cutoff) ?? eventLevel.at(-1)
  return Math.max((latest.tickets_sold ?? 0) - (prior?.tickets_sold ?? 0), 0)
}

function mapEvent(e: RawEvent, last7Sold: number): LiveEvent {
  const capacity = e.capacity ?? e.legal_capacity ?? 0
  const sold = e.total_count ?? 0
  const eventDate = (e.performance_date ?? '').slice(0, 10)
  // percent_sold is authoritative when present - it respects the event's own
  // comps/holds settings, which a naive sold/capacity does not.
  const sellThrough = e.percent_sold != null
    ? Math.min(e.percent_sold > 1.5 ? e.percent_sold / 100 : e.percent_sold, 1.5)
    : capacity > 0 ? Math.min(sold / capacity, 1.5) : 0

  return {
    id: e.id,
    name: e.booking_name || toList(e.artist_names).join(', ') || e.venue_name || 'Show',
    venue: e.venue_name ?? '',
    city: e.city ?? '',
    region: e.region ?? e.region_code ?? null,
    country: e.country_code ?? e.country ?? '',
    latitude: e.google_places_lat ?? null,
    longitude: e.google_places_long ?? null,
    capacity,
    eventDate,
    onSaleDate: e.onsale_date ? e.onsale_date.slice(0, 10) : null,
    currency: e.currency_code ?? 'USD',
    sold,
    comps: e.effective_comps ?? e.total_comps ?? 0,
    holds: e.effective_holds ?? e.total_holds ?? 0,
    sellThrough,
    soldOut: Boolean(e.sold_out),
    isFinal: Boolean(e.is_final),
    ticketLink: e.external_ticket_link ?? null,
    last7Sold,
    daysToShow: eventDate
      ? Math.round((new Date(`${eventDate}T00:00:00Z`).getTime() - Date.now()) / 86_400_000)
      : 0,
  }
}

/** Small concurrency limiter - keeps the counts fan-out from becoming a stampede. */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++]!
      await fn(item)
    }
  })
  await Promise.all(workers)
}
