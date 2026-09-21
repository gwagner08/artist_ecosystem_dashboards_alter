import { Router } from 'express'
import { buildEcosystem, overrideStorageStatus, providerStatuses, addDays } from './ecosystem.ts'
import { clearOverride, overridesRevision, saveOverride } from './overrides.ts'
import {
  fetchCreatorBreakdown, fetchTrackTopShorts, fetchTrackTopVideos, type UgcVideoRaw,
} from './clients/chartmetric.ts'
import type { CreatorDimension, UgcVideo } from '@shared/types.ts'

/** The two video endpoints nest their counters differently; flatten both. */
function normaliseVideo(v: UgcVideoRaw): UgcVideo {
  return {
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
  }
}
import { mapLimit } from './concurrency.ts'
import { buildRoster, scan, unassignedProfiles } from './registry.ts'
import { cached, clearCache } from './cache.ts'
import { config, useFixtures } from './config.ts'
import type { AccountFilter, NetworkFilter, RosterEntry } from '@shared/types.ts'

const ACCOUNT_FILTERS: AccountFilter[] = ['all', 'artist', 'fan']
const NETWORK_FILTERS: NetworkFilter[] = [
  'all', 'instagram', 'tiktok', 'youtube', 'facebook',
  'twitter', 'threads', 'linkedin', 'pinterest', 'bluesky',
]

/** Unknown values fall back to 'all' rather than silently emptying the view. */
function filtersFrom(q: Record<string, unknown>): { accountType: AccountFilter; network: NetworkFilter } {
  const accountType = ACCOUNT_FILTERS.find((v) => v === q.accountType) ?? 'all'
  const network = NETWORK_FILTERS.find((v) => v === q.network) ?? 'all'
  return { accountType, network }
}

export const api = Router()

const DATE = /^\d{4}-\d{2}-\d{2}$/
const today = () => new Date().toISOString().slice(0, 10)

function range(q: Record<string, unknown>) {
  const to = DATE.test(String(q.to)) ? String(q.to) : today()
  const from = DATE.test(String(q.from)) ? String(q.from) : addDays(to, -89)
  // Sprout caps reporting_period at one year per request.
  return from > to ? { from: addDays(to, -89), to } : { from: maxDate(from, addDays(to, -364)), to }
}

const maxDate = (a: string, b: string) => (a > b ? a : b)

api.get('/health', (_req, res) => {
  res.json({
    ok: true,
    group: { ids: config.sprout.groupIds, name: config.sprout.groupName },
    providers: providerStatuses(),
    overrideStorage: overrideStorageStatus(),
    anyFixtures: Object.values(useFixtures).some(Boolean),
  })
})

api.get('/roster', async (_req, res, next) => {
  try {
    const artists = await buildRoster()
    const { from, to } = range({})

    /*
     * The roster shows a handful of headline numbers per artist, so it skips the two
     * expensive things the detail tabs need: post analytics (several requests per
     * network) and per-event ticket velocity (one request per upcoming show). Those
     * alone were most of the work on this screen.
     *
     * Artists then run in parallel with a ceiling. Sprout allows 60 requests/minute
     * and is the tightest limit, so this stays deliberately conservative - and the
     * whole payload is cached, so a reload is instant.
     */
    const entries = await cached(`roster:${from}:${to}:${overridesRevision()}`, config.cacheTtlSeconds, async () => {
      const built = await mapLimit(artists, 4, async (artist) => {
        const eco = await buildEcosystem(artist.slug, from, to, undefined, {
          includePosts: false,
          includeVelocity: false,
          includeUgc: false,
        })
        if (!eco) return null

        const followers = eco.social.byNetwork.reduce((a, n) => a + (n.followers.current ?? 0), 0)
        const prevFollowers = eco.social.byNetwork.reduce((a, n) => a + (n.followers.previous ?? 0), 0)
        const upcoming = eco.live.events.filter((e) => e.daysToShow >= 0)

        return {
          slug: artist.slug,
          name: artist.name,
          imageUrl: eco.streaming.source.imageUrl,
          chartmetricArtistId: eco.streaming.source.artistId,
          chartmetricCandidates: eco.streaming.source.candidates,
          networks: [...new Set(artist.profiles.map((p) => p.network))],
          followers: followers || null,
          followerChangePct: prevFollowers > 0 ? (followers - prevFollowers) / prevFollowers : null,
          engagementRate: eco.social.reach.engagementRate,
          monthlyListeners: eco.streaming.monthlyListeners.current,
          upcomingEvents: upcoming.length,
          sellThrough: eco.live.totalCapacity > 0 ? eco.live.totalSold / eco.live.totalCapacity : null,
        } satisfies RosterEntry
      })
      return built.filter((e): e is RosterEntry => e !== null)
    })
    const diagnostics = await scan().catch(() => null)
    res.json({
      artists: entries,
      providers: providerStatuses(),
      range: { from, to },
      // Surfaced so an empty roster can say why, rather than just looking broken.
      diagnostics: diagnostics && {
        groupIds: config.sprout.groupIds,
        totalProfiles: diagnostics.totalProfiles,
        matchedProfiles: diagnostics.profiles.length,
        skippedNetworks: diagnostics.skippedNetworks,
        // Profiles that matched no artist on an authoritative roster - shown so a
        // missing account is visible rather than silently absent.
        unassigned: unassignedProfiles().map((p) => ({
          customerProfileId: p.customerProfileId,
          name: p.name,
          network: p.network,
        })),
        assignableArtists: artists.map((a) => ({ slug: a.slug, name: a.name })),
        topGroups: Object.entries(diagnostics.groupsSeen)
          .map(([id, count]) => ({ groupId: Number(id), profiles: count }))
          .sort((a, b) => b.profiles - a.profiles)
          .slice(0, 8),
      },
    })
  } catch (err) { next(err) }
})

api.get('/artist/:slug', async (req, res, next) => {
  try {
    const { from, to } = range(req.query as Record<string, unknown>)
    const eco = await buildEcosystem(req.params.slug, from, to, filtersFrom(req.query as Record<string, unknown>))
    if (!eco) return res.status(404).json({ error: `No artist "${req.params.slug}" in the ${config.sprout.groupName} group.` })
    res.json(eco)
  } catch (err) { next(err) }
})

/**
 * Correct one account: force its type, or drop it out of its artist's ecosystem.
 * Persisted, so it survives a restart wherever OVERRIDES_PATH is durable.
 */
api.put('/accounts/:profileId', (req, res, next) => {
  try {
    const customerProfileId = Number(req.params.profileId)
    if (!Number.isFinite(customerProfileId)) {
      return res.status(400).json({ error: 'profileId must be a number' })
    }
    const { included, accountType, artistSlug, artistName, note } = req.body ?? {}
    if (accountType !== undefined && accountType !== 'artist' && accountType !== 'fan') {
      return res.status(400).json({ error: "accountType must be 'artist' or 'fan'" })
    }
    if (included !== undefined && typeof included !== 'boolean') {
      return res.status(400).json({ error: 'included must be a boolean' })
    }
    if (artistSlug !== undefined && (typeof artistSlug !== 'string' || !artistSlug.trim())) {
      return res.status(400).json({ error: 'artistSlug must be a non-empty string' })
    }
    res.json(saveOverride({ customerProfileId, included, accountType, artistSlug, artistName, note }))
  } catch (err) { next(err) }
})

/** Drop the correction and fall back to the inferred classification. */
api.delete('/accounts/:profileId', (req, res, next) => {
  try {
    clearOverride(Number(req.params.profileId))
    res.json({ ok: true })
  } catch (err) { next(err) }
})

/**
 * Videos using one sound. Separate from the artist payload because it is a
 * drill-down: only fetched when someone actually opens a sound.
 */
api.get('/sound/:trackId/videos', async (req, res, next) => {
  try {
    const { trackId } = req.params
    const platform = req.query.platform === 'youtube' ? 'youtube' : 'tiktok'
    const type = String(req.query.type ?? 'views')
    const byId = req.query.bySoundId === 'true'
    // 0 or absent means all-time; anything else scopes to videos posted in that window.
    const rawDays = Number(req.query.days ?? 0)
    const days = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(Math.round(rawDays), 365) : undefined

    const sorts = new Set(['likes', 'views', 'comments', 'shares', 'saves', 'created_at', 'trending'])
    const sort = sorts.has(type) ? type : 'views'

    if (platform === 'youtube') {
      const shortSorts = new Set(['likes', 'views', 'comments', 'trending', 'created_at'])
      const result = await cached(`cm:shorts:${trackId}:${sort}:${days ?? 'all'}`, config.cacheTtlSeconds, () =>
        fetchTrackTopShorts(trackId, {
          type: (shortSorts.has(sort) ? sort : 'views') as 'views',
          limit: 24,
          bySoundId: byId,
          postedWithinDaysAgo: days,
        }))
      return res.json({
        platform,
        total: result.total,
        videos: result.videos.map(normaliseVideo),
      })
    }

    const videos = await cached(`cm:videos:${trackId}:${sort}:${days ?? 'all'}`, config.cacheTtlSeconds, () =>
      fetchTrackTopVideos(trackId, {
        type: sort as 'views', limit: 24, byTiktokId: byId, postedWithinDaysAgo: days,
      }))
    res.json({ platform, total: null, videos: videos.map(normaliseVideo) })
  } catch (err) { next(err) }
})

/** Creator breakdown for one dimension, fetched when the UGC tab switches. */
api.get('/artist-ugc/:artistId/breakdown', async (req, res, next) => {
  try {
    const artistId = Number(req.params.artistId)
    if (!Number.isFinite(artistId)) return res.status(400).json({ error: 'artistId must be a number' })

    const allowed = new Set(['country', 'age-gender', 'category', 'subcategory', 'language'])
    const raw = String(req.query.dimension ?? 'country')
    const dimension = (allowed.has(raw) ? raw : 'country') as CreatorDimension
    const rawPeriod = Number(req.query.periodDays ?? 30)
    const periodDays = Number.isFinite(rawPeriod) && rawPeriod > 0
      ? Math.min(Math.round(rawPeriod), 365) : 30

    const result = await cached(
      `cm:ugc:breakdown:${artistId}:${dimension}:${periodDays}`,
      config.cacheTtlSeconds,
      () => fetchCreatorBreakdown(artistId, dimension, periodDays),
    )
    if (!result) return res.json(null)
    res.json({
      dimension: result.dimension,
      periodDays: result.periodDays,
      total: result.total,
      rows: result.rows.map((r) => ({
        value: r.value, label: r.value, count: r.count, share: r.share,
        ageGroup: r.ageGroup, gender: r.gender, delta: r.delta,
      })),
    })
  } catch (err) { next(err) }
})

api.post('/cache/clear', (_req, res) => {
  clearCache()
  res.json({ ok: true })
})
