/** Composes one artist's full ecosystem payload from the three providers. */
import { config, useFixtures } from './config.ts'
import { cached } from './cache.ts'
import { fetchPosts, fetchProfileAnalytics } from './clients/sprout.ts'
import {
  fetchArtistTopVideos, fetchCreatorBreakdown, fetchLatestStats, fetchListenerCities,
  fetchSpotifyStats, fetchTopCreators, fetchTopUgcTracks, getArtist, resolveArtist,
} from './clients/chartmetric.ts'
import { fetchEvents, searchArtists } from './clients/realcount.ts'
import {
  fixtureCities, fixtureEvents, fixturePosts, fixtureSocialDays, fixtureStreaming,
} from './fixtures/generate.ts'
import { findArtist } from './registry.ts'
import { overridesWritable } from './overrides.ts'
import type {
  AccountFilter, Artist, ArtistEcosystem, ArtistUgc, CreatorBreakdownRow, ListenerCity, LiveEvent, MarketConversion,
  EngagementBasis, MetricDelta, Network, NetworkFilter, ProviderStatus, SocialDay,
  SocialPost, StreamingPoint,
} from '@shared/types.ts'

export interface EcosystemFilters {
  accountType: AccountFilter
  network: NetworkFilter
}

export interface EcosystemOptions {
  /** Post analytics are several requests per network and only the Posts tab uses them. */
  includePosts?: boolean
  /** Per-event ticket velocity is one request per upcoming show. */
  includeVelocity?: boolean
  /** UGC is three more Chartmetric calls, and the roster does not show it. */
  includeUgc?: boolean
}

/** Ephemeral-looking paths mean corrections vanish on redeploy; the UI warns. */
export function overrideStorageStatus() {
  const status = overridesWritable()
  const ephemeral = !/^\/(var\/data|data|mnt|persist)/.test(status.path)
  return { ...status, ephemeral }
}

export function providerStatuses(): ProviderStatus[] {
  return [
    {
      provider: 'sprout',
      mode: useFixtures.sprout ? 'fixtures' : 'live',
      detail: useFixtures.sprout
        ? 'Set SPROUT_API_TOKEN and SPROUT_CUSTOMER_ID to go live.'
        : `Group ${config.sprout.groupIds.join(', ') || 'ALL'} (${config.sprout.groupName}).`,
    },
    {
      provider: 'chartmetric',
      mode: useFixtures.chartmetric ? 'fixtures' : 'live',
      detail: useFixtures.chartmetric
        ? 'Set CHARTMETRIC_REFRESH_TOKEN to go live.'
        : 'Live. Artists need chartmetricArtistId in config/artists.json.',
    },
    {
      provider: 'realcount',
      mode: useFixtures.realcount ? 'fixtures' : 'live',
      detail: useFixtures.realcount
        ? 'Set REALCOUNT_CLIENT_ID and REALCOUNT_CLIENT_SECRET to go live.'
        : 'Live against realcount.pro/api/v2.',
    },
  ]
}

/** Splits the range in half so every headline number can carry a like-for-like delta. */
function priorRange(from: string, to: string) {
  const start = new Date(`${from}T00:00:00Z`).getTime()
  const end = new Date(`${to}T00:00:00Z`).getTime()
  const span = Math.max(end - start, 86_400_000)
  return {
    from: new Date(start - span).toISOString().slice(0, 10),
    to: new Date(start - 86_400_000).toISOString().slice(0, 10),
  }
}

function delta(current: number | null, previous: number | null): MetricDelta {
  const changePct = current != null && previous != null && previous !== 0
    ? (current - previous) / Math.abs(previous)
    : null
  return { current, previous, changePct }
}

const sum = (values: Array<number | null>) => {
  const nums = values.filter((v): v is number => typeof v === 'number')
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null
}

/** Followers is a snapshot, not a flow - take the last reading, never the sum. */
const latestFollowers = (days: SocialDay[]) => {
  const byProfile = new Map<number, SocialDay>()
  for (const d of days) {
    if (d.followers == null) continue
    const prev = byProfile.get(d.customerProfileId)
    if (!prev || d.date > prev.date) byProfile.set(d.customerProfileId, d)
  }
  const total = [...byProfile.values()].reduce((acc, d) => acc + (d.followers ?? 0), 0)
  return byProfile.size ? total : null
}

/**
 * Current and prior windows in ONE Sprout request where the combined span allows it.
 * Sprout caps reporting_period at a year and is rate limited to 60 requests/minute,
 * so halving the request count matters more than the slightly larger response.
 */
async function socialWindow(
  artist: Artist, from: string, to: string, prior: { from: string; to: string },
): Promise<{ current: SocialDay[]; previous: SocialDay[] }> {
  const spanDays = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${prior.from}T00:00:00Z`)) / 86_400_000

  if (spanDays <= 364) {
    const all = await socialFor(artist, prior.from, to)
    return {
      current: all.filter((d) => d.date >= from),
      previous: all.filter((d) => d.date < from),
    }
  }

  const [current, previous] = await Promise.all([
    socialFor(artist, from, to),
    socialFor(artist, prior.from, prior.to),
  ])
  return { current, previous }
}

async function socialFor(artist: Artist, from: string, to: string): Promise<SocialDay[]> {
  if (useFixtures.sprout) return fixtureSocialDays(artist.slug, artist.profiles, from, to)

  const byNetwork = new Map<Network, number[]>()
  for (const p of artist.profiles) {
    byNetwork.set(p.network, [...(byNetwork.get(p.network) ?? []), p.customerProfileId])
  }
  const results = await Promise.all(
    [...byNetwork].map(([network, ids]) =>
      cached(`sprout:analytics:${network}:${ids.join(',')}:${from}:${to}`, config.cacheTtlSeconds,
        () => fetchProfileAnalytics(network, ids, from, to)),
    ),
  )
  return results.flat()
}

async function postsFor(artist: Artist, from: string, to: string): Promise<SocialPost[]> {
  if (useFixtures.sprout) return fixturePosts(artist.slug, artist.profiles, from, to)

  const byNetwork = new Map<Network, typeof artist.profiles>()
  for (const p of artist.profiles) {
    byNetwork.set(p.network, [...(byNetwork.get(p.network) ?? []), p])
  }
  const results = await Promise.all(
    [...byNetwork].map(([network, profiles]) =>
      cached(`sprout:posts:${network}:${profiles.map((p) => p.customerProfileId).join(',')}:${from}:${to}`,
        config.cacheTtlSeconds, () => fetchPosts(network, profiles, from, to)),
    ),
  )
  return results.flat()
}

/**
 * Joins tour markets to streaming demand in the same city.
 *
 * The verdicts are a triage aid, not a verdict on the booking:
 *   underconverting - real listening demand, soft ticket sales. Look at the marketing.
 *   underplayed     - selling out against a modest listener base. The room was too small.
 * Both thresholds are deliberately blunt and easy to change.
 */
function buildMarkets(events: LiveEvent[], cities: ListenerCity[]): MarketConversion[] {
  const cityIndex = new Map(cities.map((c) => [c.city.toLowerCase(), c]))
  const grouped = new Map<string, LiveEvent[]>()
  for (const e of events) {
    const key = e.city.toLowerCase()
    grouped.set(key, [...(grouped.get(key) ?? []), e])
  }

  return [...grouped.entries()].map(([key, evts]) => {
    const capacity = evts.reduce((a, e) => a + e.capacity, 0)
    const sold = evts.reduce((a, e) => a + e.sold, 0)
    const sellThrough = capacity > 0 ? sold / capacity : 0

    // Coordinates beat names: RealCount gives Google Places lat/long, and matching on
    // distance survives "NYC" vs "New York" and every other spelling difference.
    const withCoords = evts.find((e) => e.latitude != null && e.longitude != null)
    let match = withCoords ? nearestCity(withCoords.latitude!, withCoords.longitude!, cities) : null
    let matchedBy: MarketConversion['matchedBy'] = match ? 'coordinates' : 'none'
    if (!match) {
      match = cityIndex.get(key) ?? null
      matchedBy = match ? 'name' : 'none'
    }

    const listeners = match?.listeners ?? null
    const ticketsPer1kListeners = listeners && listeners > 0 ? (sold / listeners) * 1000 : null

    let verdict: MarketConversion['verdict'] = 'unknown'
    if (listeners != null) {
      if (sellThrough >= 0.95) verdict = 'underplayed'
      else if (sellThrough < 0.6 && listeners > 20_000) verdict = 'underconverting'
      else verdict = 'on-track'
    }

    return {
      city: evts[0]!.city,
      country: evts[0]!.country,
      listeners, capacity, sold, sellThrough, ticketsPer1kListeners,
      events: evts.map((e) => e.name),
      matchedBy,
      verdict,
    }
  }).sort((a, b) => (b.listeners ?? 0) - (a.listeners ?? 0))
}

export async function buildEcosystem(
  slug: string,
  from: string,
  to: string,
  filters: EcosystemFilters = { accountType: 'all', network: 'all' },
  options: EcosystemOptions = {},
): Promise<ArtistEcosystem | null> {
  const { includePosts = true, includeVelocity = true, includeUgc = true } = options
  const artist = await findArtist(slug)
  if (!artist) return null

  const warnings: string[] = []
  const prior = priorRange(from, to)

  // Always fetch every profile, then slice in memory. Filtering before the fetch
  // would change the cache key, so every toggle would cost fresh Sprout requests
  // against a 60/minute limit.
  const [window, allPosts] = await Promise.all([
    socialWindow(artist, from, to, prior),
    includePosts
      ? postsFor(artist, from, to).catch((err) => {
          warnings.push(`Post analytics unavailable: ${(err as Error).message}`)
          return [] as SocialPost[]
        })
      : Promise.resolve([] as SocialPost[]),
  ])
  const allDaily = window.current
  const allPriorDaily = window.previous

  // A manually excluded account is out of every number for this artist, whatever
  // the toggles say - that is the point of excluding it.
  const active = artist.profiles.filter((p) => p.included)
  const selectedIds = new Set(
    active
      .filter((p) => filters.accountType === 'all' || p.accountType === filters.accountType)
      .filter((p) => filters.network === 'all' || p.network === filters.network)
      .map((p) => p.customerProfileId),
  )
  const keep = <T extends { customerProfileId: number }>(rows: T[]) =>
    rows.filter((r) => selectedIds.has(r.customerProfileId))

  const daily = keep(allDaily)
  const priorDaily = keep(allPriorDaily)
  const posts = keep(allPosts)

  const accountCounts = {
    all: active.length,
    artist: active.filter((p) => p.accountType === 'artist').length,
    fan: active.filter((p) => p.accountType === 'fan').length,
    excluded: artist.profiles.length - active.length,
  }
  const availableNetworks = [...new Set(active.map((p) => p.network))]

  if (selectedIds.size === 0) {
    warnings.push('No accounts match this filter, so the social panels are empty.')
  }

  // Streaming. A pinned ID in config/artists.json always wins; otherwise resolve the
  // name against Chartmetric, which is what makes this work with no config at all.
  let series: StreamingPoint[] = []
  let cities: ListenerCity[] = []
  let latest: Awaited<ReturnType<typeof fetchLatestStats>> = null
  // The UGC endpoints take a number of days, not a date pair. Measure the span of
  // the selected range rather than the distance from `from` to now, so a "7d" preset
  // reports 7 rather than 8 depending on the time of day.
  const windowDays = Math.max(
    1,
    Math.min(365, Math.round(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
    )),
  )

  let ugc: ArtistUgc = {
    available: false, sounds: [], creators: [], breakdown: null,
    recentVideos: [], windowDays,
    demographics: { ageGender: [], language: [], total: 0 },
    totals: { posts: null, views: null },
  }
  let cmSource: ArtistEcosystem['streaming']['source'] = {
    artistId: null, matchedBy: null, imageUrl: null, coverUrl: null, candidates: [],
  }

  if (useFixtures.chartmetric) {
    series = fixtureStreaming(artist.slug, from, to)
    cities = fixtureCities(artist.slug)
    cmSource = { artistId: null, matchedBy: null, imageUrl: null, coverUrl: null, candidates: [] }
  } else {
    let id = artist.chartmetricArtistId
    if (id != null) {
      cmSource = { artistId: id, matchedBy: 'config', imageUrl: null, coverUrl: null, candidates: [] }
    } else {
      let lookupFailed = false
      const match = await cached(
        `cm:resolve:${artist.name}`, 86_400, () => resolveArtist(artist.name),
        // A miss is retried in an hour; a hit is good for a day.
        (m) => (m.artistId == null ? 3_600 : 86_400),
      )
        .catch((err) => {
          lookupFailed = true
          warnings.push(`Chartmetric lookup failed for ${artist.name}: ${(err as Error).message}`)
          return { artistId: null, matchedBy: null, candidates: [] as Array<{ id: number; name: string }> }
        })
      id = match.artistId
      cmSource = {
        artistId: match.artistId, matchedBy: match.matchedBy,
        imageUrl: null, coverUrl: null, candidates: match.candidates,
      }

      // A failed request tells us nothing about whether the artist exists, so don't
      // follow the error with a claim that it doesn't.
      if (id == null && !lookupFailed) {
        warnings.push(
          match.candidates.length
            ? `No exact Chartmetric match for "${artist.name}". Closest: ${
                match.candidates.map((c) => `${c.name} (id ${c.id})`).join(', ')
              }. Pin the right one as chartmetricArtistId in config/artists.json.`
            : `Chartmetric has no artist named "${artist.name}". Pin the correct chartmetricArtistId in config/artists.json.`,
        )
      }
    }

    if (id != null) {
      const artistId = id
      // Artwork changes rarely, so it is cached for a day rather than the data TTL.
      const meta = await cached(
        `cm:meta:${artistId}`, 86_400, () => getArtist(artistId),
        (m) => (m?.imageUrl ? 86_400 : 3_600),
      ).catch(() => null)
      // Some artists have only a banner; better that than initials.
      cmSource = {
        ...cmSource,
        imageUrl: meta?.imageUrl ?? meta?.coverUrl ?? null,
        coverUrl: meta?.coverUrl ?? null,
      }

      const [s, c, l] = await Promise.all([
        cached(`cm:stats:${artistId}:${from}:${to}`, config.cacheTtlSeconds, () => fetchSpotifyStats(artistId, from, to))
          .catch((err) => { warnings.push(`Chartmetric stats failed: ${(err as Error).message}`); return [] }),
        cached(`cm:cities:${artistId}`, config.cacheTtlSeconds, () => fetchListenerCities(artistId))
          .catch((err) => { warnings.push(`Chartmetric cities failed: ${(err as Error).message}`); return [] }),
        cached(`cm:latest:${artistId}`, config.cacheTtlSeconds, () => fetchLatestStats(artistId))
          .catch(() => null),
      ])
      series = s; cities = c; latest = l

      if (includeUgc) {
        // Premium endpoints. Every reader degrades to empty rather than throwing,
        // so a plan without UGC loses the panel, not the page.
        const [rawSounds, rawCreators, rawBreakdown, rawVideos, rawAgeGender, rawLanguage] = await Promise.all([
          // Sounds have no date filter, so this is all-time whatever the range says.
          cached(`cm:ugc:tracks:${artistId}`, config.cacheTtlSeconds, () => fetchTopUgcTracks(artistId, 'tiktok', 20)),
          cached(`cm:ugc:creators:${artistId}`, config.cacheTtlSeconds, () => fetchTopCreators(artistId, { limit: 25 })),
          // These two DO honour the range.
          cached(`cm:ugc:breakdown:${artistId}:country:${windowDays}`, config.cacheTtlSeconds,
            () => fetchCreatorBreakdown(artistId, 'country', windowDays)),
          cached(`cm:ugc:videos:${artistId}:${windowDays}`, config.cacheTtlSeconds,
            () => fetchArtistTopVideos(artistId, { type: 'views', limit: 24, postedWithinDaysAgo: windowDays })),
          // The demographics card needs both of these at once.
          cached(`cm:ugc:breakdown:${artistId}:age-gender:${windowDays}`, config.cacheTtlSeconds,
            () => fetchCreatorBreakdown(artistId, 'age-gender', windowDays)),
          cached(`cm:ugc:breakdown:${artistId}:language:${windowDays}`, config.cacheTtlSeconds,
            () => fetchCreatorBreakdown(artistId, 'language', windowDays)),
        ])

        const sounds = rawSounds.map((t) => ({
          trackId: t.cm_track ?? null,
          platformSoundId: t.tiktok ?? t.youtube ?? null,
          name: t.name ?? 'Untitled sound',
          isrc: t.isrc ?? null,
          posts: t.posts ?? null,
          views: t.views ?? null,
          likes: t.likes ?? null,
          comments: t.comments ?? null,
          engagementRate: t.engagementRate ?? null,
          score: t.score ?? null,
        }))

        const sum = (pick: (s: typeof sounds[number]) => number | null) => {
          const vals = sounds.map(pick).filter((v): v is number => typeof v === 'number')
          return vals.length ? vals.reduce((a, b) => a + b, 0) : null
        }

        ugc = {
          available: sounds.length > 0 || rawCreators.length > 0
            || (rawBreakdown?.rows.length ?? 0) > 0 || rawVideos.length > 0,
          sounds,
          creators: rawCreators.map((c) => ({
            handle: c.handle ?? '',
            fullName: c.full_name ?? null,
            followers: c.followers ?? null,
            isVerified: Boolean(c.is_verified),
            country: c.country ?? null,
            ageGroup: c.age_group ?? null,
            gender: c.gender ?? null,
            categories: c.categories ?? [],
            engagementRate: c.engagement_rate ?? null,
            avgViews: c.avg_views ?? null,
            videoCount: c.video_count ?? null,
            featuredTrack: c.featured_track ?? null,
          })).filter((c) => c.handle),
          breakdown: rawBreakdown && {
            dimension: rawBreakdown.dimension,
            periodDays: rawBreakdown.periodDays,
            total: rawBreakdown.total,
            rows: rawBreakdown.rows.map(toBreakdownRow),
          },
          recentVideos: rawVideos.map((v) => ({
            videoId: String(v.video_id ?? ''),
            username: v.username ?? null,
            title: v.video_title ?? null,
            link: v.link ?? null,
            createdAt: v.created_at ?? null,
            views: v.stats?.views ?? v.views ?? null,
            likes: v.stats?.likes ?? v.likes ?? null,
            comments: v.stats?.comments ?? v.comments ?? null,
            shares: v.stats?.shares ?? null,
            followers: v.followers ?? null,
            viewsPercentChange: v.viewsPercentChange ?? null,
          })).filter((v) => v.videoId),
          windowDays,
          demographics: {
            ageGender: (rawAgeGender?.rows ?? []).map(toBreakdownRow),
            language: (rawLanguage?.rows ?? []).map(toBreakdownRow),
            total: rawAgeGender?.total ?? rawBreakdown?.total ?? 0,
          },
          totals: { posts: sum((s) => s.posts), views: sum((s) => s.views) },
        }
      }

      if (series.length === 0 && cities.length === 0) {
        warnings.push(`Chartmetric returned nothing for artist id ${artistId}. If that is the wrong artist, pin the right chartmetricArtistId in config/artists.json.`)
      }
    }
  }

  // Live. RealCount filters events by artist NAME, so unlike Chartmetric this works
  // without any per-artist config - the UUID only sharpens partial-name collisions.
  let events: LiveEvent[] = []
  if (useFixtures.realcount) {
    events = fixtureEvents(artist.slug)
  } else {
    const rcName = artist.realcountArtistName ?? artist.name
    events = await cached(
      `rc:events:${rcName}:${artist.realcountArtistId ?? ''}:${from}:${includeVelocity ? 'v' : 'nov'}`,
      config.cacheTtlSeconds,
      () => fetchEvents(rcName, from, addDays(to, 365), artist.realcountArtistId, { includeVelocity }),
    )
      .catch((err) => { warnings.push(`RealCount failed: ${(err as Error).message}`); return [] })
    if (events.length === 0) {
      warnings.push(`No RealCount events matched "${rcName}". If RealCount books this artist under a different name, set realcountArtistName in config/artists.json.`)
    }
  }

  const networks = [...new Set(
    active.filter((p) => selectedIds.has(p.customerProfileId)).map((p) => p.network),
  )]

  /**
   * Reach beats impressions as an engagement-rate denominator: impressions counts a
   * repeat viewer twice, so dividing by it flatters the rate. Views are a last
   * resort - TikTok reports no reach at profile level, only total video views, and a
   * views-based rate is still more useful than excluding TikTok altogether.
   */
  const denominatorFor = (rows: SocialDay[]): { value: number | null; basis: EngagementBasis | null } => {
    const reach = sum(rows.map((d) => d.reach))
    if (reach && reach > 0) return { value: reach, basis: 'reach' }
    const impressions = sum(rows.map((d) => d.impressions))
    if (impressions && impressions > 0) return { value: impressions, basis: 'impressions' }
    const views = sum(rows.map((d) => d.videoViews))
    if (views && views > 0) return { value: views, basis: 'views' }
    return { value: null, basis: null }
  }

  const byNetwork = networks.map((network) => {
    const now = daily.filter((d) => d.network === network)
    const before = priorDaily.filter((d) => d.network === network)
    const engagements = sum(now.map((d) => d.engagements))
    const den = denominatorFor(now)

    return {
      network,
      followers: delta(latestFollowers(now), latestFollowers(before)),
      impressions: delta(sum(now.map((d) => d.impressions)), sum(before.map((d) => d.impressions))),
      reach: delta(sum(now.map((d) => d.reach)), sum(before.map((d) => d.reach))),
      engagements: delta(engagements, sum(before.map((d) => d.engagements))),
      engagementRate: den.value && engagements != null ? engagements / den.value : null,
      engagementBasis: den.basis,
    }
  })

  /*
   * The blended rate sums each network's own best denominator, so a network with
   * reach contributes reach and TikTok contributes views - rather than TikTok being
   * dropped for lacking impressions, which is what used to happen. Networks with no
   * denominator at all stay excluded from both sides.
   */
  const rated = byNetwork.filter((n) => n.engagementBasis != null)
  const excludedNetworks = byNetwork.filter((n) => n.engagementBasis == null).map((n) => n.network)
  const bases = [...new Set(rated.map((n) => n.engagementBasis!))]

  const denOf = (network: Network, rows: SocialDay[]) => {
    const entry = byNetwork.find((n) => n.network === network)
    const subset = rows.filter((d) => d.network === network)
    if (entry?.engagementBasis === 'reach') return sum(subset.map((d) => d.reach))
    if (entry?.engagementBasis === 'impressions') return sum(subset.map((d) => d.impressions))
    if (entry?.engagementBasis === 'views') return sum(subset.map((d) => d.videoViews))
    return null
  }

  const ratedImpressions = sum(rated.map((n) => denOf(n.network, daily)))
  const ratedEngagements = sum(rated.map((n) => n.engagements.current))
  const priorImpressions = sum(rated.map((n) => denOf(n.network, priorDaily)))
  const priorEngagements = sum(rated.map((n) => n.engagements.previous))

  /*
   * The series date axis is the union of listeners, followers and popularity, so the
   * newest row can legitimately have a null listener count - which rendered the
   * headline as "—" while the chart plotted 5.7M right beside it. Take the newest
   * row that actually has a value, and fall back to the cmStats snapshot.
   */
  const newestValue = (pick: (p: StreamingPoint) => number | null): number | null => {
    for (let i = series.length - 1; i >= 0; i--) {
      const v = pick(series[i]!)
      if (v != null) return v
    }
    return null
  }
  const oldestValue = (pick: (p: StreamingPoint) => number | null): number | null => {
    for (const point of series) {
      const v = pick(point)
      if (v != null) return v
    }
    return null
  }

  const listenersNow = newestValue((p) => p.spotifyListeners) ?? latest?.monthlyListeners ?? null
  const listenersBefore = oldestValue((p) => p.spotifyListeners)
  const spFollowersNow = newestValue((p) => p.spotifyFollowers) ?? latest?.followers ?? null

  return {
    artist,
    range: { from, to },
    filters,
    accountCounts,
    availableNetworks,
    providers: providerStatuses(),
    overrideStorage: overrideStorageStatus(),
    warnings,
    social: {
      daily,
      byNetwork,
      // Capped so a heavy artist can't return a multi-megabyte payload.
      posts: [...posts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 400),
      topPosts: posts
        .filter((p) => p.engagements != null)
        .sort((a, b) => (b.engagements ?? 0) - (a.engagements ?? 0))
        .slice(0, 10),
      reach: {
        impressions: delta(ratedImpressions, priorImpressions),
        engagements: delta(ratedEngagements, priorEngagements),
        engagementRate: ratedImpressions && ratedImpressions > 0 && ratedEngagements != null
          ? ratedEngagements / ratedImpressions : null,
        previousEngagementRate: priorImpressions && priorImpressions > 0 && priorEngagements != null
          ? priorEngagements / priorImpressions : null,
        excludedNetworks,
        bases,
      },
    },
    streaming: {
      source: cmSource,
      series,
      monthlyListeners: delta(listenersNow, listenersBefore),
      spotifyFollowers: delta(spFollowersNow, oldestValue((p) => p.spotifyFollowers)),
      followerConversion: listenersNow && listenersNow > 0 && spFollowersNow != null
        ? spFollowersNow / listenersNow : null,
      cities,
    },
    ugc,
    live: {
      events,
      totalSold: events.reduce((a, e) => a + e.sold, 0),
      totalCapacity: events.reduce((a, e) => a + e.capacity, 0),
      markets: buildMarkets(events, cities),
    },
  }
}

/** Nearest listener city within 75km, or null. Haversine, in kilometres. */
function nearestCity(lat: number, lon: number, cities: ListenerCity[]): ListenerCity | null {
  let best: ListenerCity | null = null
  let bestKm = Infinity
  for (const c of cities) {
    if (c.latitude == null || c.longitude == null) continue
    const km = haversineKm(lat, lon, c.latitude, c.longitude)
    if (km < bestKm) { bestKm = km; best = c }
  }
  return bestKm <= 75 ? best : null
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** One shape for breakdown rows, wherever they are read. */
function toBreakdownRow(r: {
  value: string; ageGroup: string | null; gender: string | null
  count: number; share: number; delta: number | null
}): CreatorBreakdownRow {
  return {
    value: r.value,
    label: r.value,
    count: r.count,
    share: r.share,
    ageGroup: r.ageGroup,
    gender: r.gender,
    delta: r.delta,
  }
}

export function addDays(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10)
}
