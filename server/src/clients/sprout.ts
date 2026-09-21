/**
 * Sprout Social Reporting API v1 client.
 *
 * Endpoint paths, filter syntax and metric names below are taken from the Sprout
 * API reference (Customer Metadata + Analytics sections). The important gotcha:
 * profile-level metric names are NOT uniform across networks. TikTok suffixes its
 * interaction metrics with `_total`, Instagram does not, and YouTube exposes almost
 * nothing at profile level beyond followers. Sending an unsupported metric name
 * makes the whole request 400, so we issue one request per network.
 */
import { config } from '../config.ts'
import { ApiError, request } from '../http.ts'
import type { Network, SocialDay, SocialPost, SproutProfile } from '@shared/types.ts'

const AUTH = () => ({ Authorization: `Bearer ${config.sprout.token}` })
const BASE = () => `${config.sprout.baseUrl}/v1/${config.sprout.customerId}`

/** Canonical field -> the network's actual metric name. `null` = network doesn't expose it. */
type MetricMap = {
  followers: string | null
  netFollowerGrowth: string | null
  impressions: string | null
  /**
   * Unique viewers — the right denominator for an engagement rate, since
   * impressions counts the same person twice. Only some networks expose it at
   * profile level; TikTok does not.
   */
  reach: string | null
  videoViews: string | null
  postsSent: string | null
  /** Summed into `engagements`. */
  engagementParts: string[]
}

export const NETWORK_PROFILE_METRICS: Record<Network, MetricMap> = {
  instagram: {
    followers: 'lifetime_snapshot.followers_count',
    netFollowerGrowth: 'net_follower_growth',
    impressions: 'impressions',
    reach: 'impressions_unique',
    videoViews: 'video_views',
    postsSent: 'posts_sent_count',
    engagementParts: ['likes', 'comments_count', 'shares_count', 'saves', 'story_replies'],
  },
  tiktok: {
    followers: 'lifetime_snapshot.followers_count',
    netFollowerGrowth: 'net_follower_growth',
    impressions: null, // TikTok has no profile-level impressions metric in the API.
    reach: null, // TikTok exposes no unique/reach metric at PROFILE level.
    videoViews: 'video_views_total',
    postsSent: 'posts_sent_count',
    engagementParts: ['likes_total', 'comments_count_total', 'shares_count_total'],
  },
  youtube: {
    followers: 'lifetime_snapshot.followers_count',
    netFollowerGrowth: 'net_follower_growth',
    impressions: null, // YouTube profile analytics are followers + posts only.
    reach: null,
    videoViews: null,
    postsSent: 'posts_sent_count',
    engagementParts: [],
  },
  facebook: {
    followers: 'lifetime_snapshot.followers_count',
    netFollowerGrowth: 'net_follower_growth',
    impressions: 'impressions',
    reach: 'impressions_unique',
    videoViews: 'video_views',
    postsSent: 'posts_sent_count',
    engagementParts: ['reactions', 'comments_count', 'shares_count', 'post_link_clicks'],
  },
  twitter: {
    followers: 'lifetime_snapshot.followers_count',
    netFollowerGrowth: 'net_follower_growth',
    impressions: 'impressions',
    reach: null, // X gives impressions only.
    videoViews: 'video_views',
    postsSent: 'posts_sent_count',
    engagementParts: ['likes', 'comments_count', 'shares_count', 'post_content_clicks'],
  },
  threads: {
    followers: null, // Threads exposes follower demographics, not a followers_count.
    netFollowerGrowth: null,
    impressions: null,
    reach: null,
    videoViews: null,
    postsSent: null,
    engagementParts: ['likes', 'comments_count', 'shares_count', 'reposts_count', 'quotes_count'],
  },
  linkedin: {
    followers: 'lifetime_snapshot.followers_count',
    netFollowerGrowth: 'net_follower_growth',
    impressions: 'impressions',
    reach: 'impressions_unique',
    videoViews: 'video_views',
    postsSent: 'posts_sent_count',
    engagementParts: ['reactions', 'comments_count', 'shares_count', 'post_content_clicks'],
  },
  pinterest: {
    followers: 'lifetime_snapshot.followers_count',
    netFollowerGrowth: 'net_follower_growth',
    impressions: 'impressions',
    reach: null,
    videoViews: null,
    postsSent: 'posts_sent_count',
    engagementParts: ['reactions', 'comments_count', 'shares_count'],
  },
  bluesky: {
    followers: 'lifetime_snapshot.followers_count',
    netFollowerGrowth: 'net_follower_growth',
    impressions: null,
    reach: null,
    videoViews: null,
    postsSent: 'posts_sent_count',
    engagementParts: ['likes', 'comments_count', 'shares_count'],
  },
}

/**
 * Post-level (`lifetime.*`) metrics, also network-specific.
 * Broken out per interaction so the posts grid can show views / likes / comments /
 * shares as separate columns rather than one opaque engagements total.
 */
interface PostMetricMap {
  /**
   * Post-level denominator. Where this is a `_unique` metric it is genuine reach,
   * which `impressionsAreReach` records so the rate can be labelled honestly.
   */
  impressions: string | null
  impressionsAreReach?: boolean
  views: string | null
  videoViews: string | null
  likes: string | null
  comments: string | null
  shares: string | null
  /** Extra interactions folded into the engagements total but not shown as columns. */
  extraEngagementParts: string[]
}

const NETWORK_POST_METRICS: Partial<Record<Network, PostMetricMap>> = {
  instagram: {
    impressions: 'lifetime.impressions',
    views: 'lifetime.views',
    videoViews: 'lifetime.video_views',
    likes: 'lifetime.likes',
    comments: 'lifetime.comments_count',
    shares: 'lifetime.shares_count',
    extraEngagementParts: ['lifetime.saves'],
  },
  tiktok: {
    // Unique viewers: genuine reach, unlike the profile-level metrics.
    impressions: 'lifetime.impressions_unique',
    impressionsAreReach: true,
    views: 'lifetime.video_views',
    videoViews: 'lifetime.video_views',
    likes: 'lifetime.likes',
    comments: 'lifetime.comments_count',
    shares: 'lifetime.shares_count',
    extraEngagementParts: [],
  },
  youtube: {
    impressions: null, // YouTube has no post-level impressions metric.
    views: 'lifetime.video_views',
    videoViews: 'lifetime.video_views',
    likes: 'lifetime.likes',
    comments: 'lifetime.comments_count',
    shares: 'lifetime.shares_count',
    extraEngagementParts: [],
  },
  facebook: {
    impressions: 'lifetime.impressions',
    views: 'lifetime.video_views',
    videoViews: 'lifetime.video_views',
    likes: 'lifetime.reactions',
    comments: 'lifetime.comments_count',
    shares: 'lifetime.shares_count',
    extraEngagementParts: [],
  },
  twitter: {
    impressions: 'lifetime.impressions',
    views: 'lifetime.video_views',
    videoViews: 'lifetime.video_views',
    likes: 'lifetime.likes',
    comments: 'lifetime.comments_count',
    shares: 'lifetime.shares_count',
    extraEngagementParts: [],
  },
  threads: {
    impressions: 'lifetime.impressions',
    views: null,
    videoViews: null,
    likes: 'lifetime.likes',
    comments: 'lifetime.comments_count',
    shares: 'lifetime.shares_count',
    extraEngagementParts: [],
  },
}

/**
 * Sprout's network_type values do not all match our canonical names, and the
 * published docs only show two of them by example. Anything unmapped used to be
 * dropped silently, which surfaced as "no artists found" with no way to tell why -
 * so unknown types are now reported rather than swallowed.
 */
const NETWORK_ALIASES: Record<string, Network> = {
  twitter: 'twitter',
  x: 'twitter',
  facebook: 'facebook',
  fb_page: 'facebook',
  facebook_page: 'facebook',
  instagram: 'instagram',
  fb_instagram_account: 'instagram',
  instagram_account: 'instagram',
  instagram_business: 'instagram',
  youtube: 'youtube',
  youtube_channel: 'youtube',
  linkedin: 'linkedin',
  linkedin_company: 'linkedin',
  linkedin_page: 'linkedin',
  pinterest: 'pinterest',
  tiktok: 'tiktok',
  tiktok_account: 'tiktok',
  tiktok_business: 'tiktok',
  threads: 'threads',
  threads_account: 'threads',
  bluesky: 'bluesky',
}

export function mapNetwork(networkType: string): Network | null {
  return NETWORK_ALIASES[networkType?.toLowerCase?.() ?? ''] ?? null
}

export interface ProfileScan {
  profiles: SproutProfile[]
  /** Profiles in the customer account, before any group filtering. */
  totalProfiles: number
  /** Matched the group filter but sat on a network we cannot map. */
  skippedNetworks: Record<string, number>
  /** Every group ID seen on a profile, with how many profiles carry it. */
  groupsSeen: Record<number, number>
}

interface SproutEnvelope<T> {
  data: T[]
  paging?: { current_page: number; total_pages: number }
  error?: string
}

interface RawProfile {
  customer_profile_id: number
  network_type: string
  name: string
  native_name: string | null
  native_id?: string
  link?: string
  groups?: number[]
}

export async function listGroups(): Promise<Array<{ group_id: number; name: string }>> {
  const res = await request<SproutEnvelope<{ group_id: number; name: string }>>(
    'sprout', `${BASE()}/metadata/customer/groups`, { headers: AUTH() },
  )
  return res.data ?? []
}

export async function listClients(): Promise<Array<{ customer_id: number; name: string }>> {
  const res = await request<SproutEnvelope<{ customer_id: number; name: string }>>(
    'sprout', `${config.sprout.baseUrl}/v1/metadata/client`, { headers: AUTH() },
  )
  return res.data ?? []
}

/**
 * Profiles in the configured group(s). The API has no group filter on the metadata
 * endpoint, so we filter on the `groups` array each profile carries.
 *
 * Accepts several group IDs because an "Alter Music Group" parent group can hold its
 * profiles only in sub-groups, in which case filtering on the parent alone matches
 * nothing.
 */
export async function scanProfiles(groupIds: number[]): Promise<ProfileScan> {
  const res = await request<SproutEnvelope<RawProfile>>(
    'sprout', `${BASE()}/metadata/customer`, { headers: AUTH() },
  )
  const all = res.data ?? []

  const groupsSeen: Record<number, number> = {}
  for (const p of all) {
    for (const g of p.groups ?? []) groupsSeen[g] = (groupsSeen[g] ?? 0) + 1
  }

  const inGroup = all.filter(
    (p) => groupIds.length === 0 || (p.groups ?? []).some((g) => groupIds.includes(g)),
  )

  const skippedNetworks: Record<string, number> = {}
  for (const p of inGroup) {
    if (!mapNetwork(p.network_type)) {
      skippedNetworks[p.network_type] = (skippedNetworks[p.network_type] ?? 0) + 1
    }
  }

  const profiles = inGroup
    .filter((p) => mapNetwork(p.network_type))
    .map((p) => ({
      customerProfileId: p.customer_profile_id,
      network: mapNetwork(p.network_type)!,
      name: p.name,
      nativeName: p.native_name ?? null,
      link: p.link ?? null,
      // Retained so account type can be inferred from sub-group membership.
      groups: p.groups ?? [],
      // Filled in by the registry; the client has no opinion on account type.
      accountType: 'artist' as const,
      accountTypeReason: 'default' as const,
      included: true,
      overridden: false,
    }))

  return { profiles, totalProfiles: all.length, skippedNetworks, groupsSeen }
}

/** Convenience wrapper for callers that only want the profiles. */
export async function listProfilesInGroup(groupIds: number[]): Promise<SproutProfile[]> {
  return (await scanProfiles(groupIds)).profiles
}

/** Profile analytics for one network's profiles across a date range, one day per row. */
export async function fetchProfileAnalytics(
  network: Network,
  profileIds: number[],
  from: string,
  to: string,
): Promise<SocialDay[]> {
  if (profileIds.length === 0) return []
  const map = NETWORK_PROFILE_METRICS[network]
  const metrics = [
    map.followers, map.netFollowerGrowth, map.impressions, map.reach,
    map.videoViews, map.postsSent, ...map.engagementParts,
  ].filter((m): m is string => Boolean(m))
  if (metrics.length === 0) return []

  const rows: Array<{ dimensions: Record<string, unknown>; metrics: Record<string, number> }> = []
  // The API caps at 100 profiles and 1,000 rows per page.
  for (const chunk of chunkArray(profileIds, 100)) {
    let page = 1
    let totalPages = 1
    do {
      const res = await request<SproutEnvelope<{ dimensions: Record<string, unknown>; metrics: Record<string, number> }>>(
        'sprout', `${BASE()}/analytics/profiles`,
        {
          method: 'POST',
          headers: AUTH(),
          body: {
            filters: [
              `customer_profile_id.eq(${chunk.join(', ')})`,
              // Sprout's reporting_period range uses a three-dot separator.
              `reporting_period.in(${from}...${to})`,
            ],
            metrics,
            page,
          },
        },
      )
      rows.push(...(res.data ?? []))
      totalPages = res.paging?.total_pages ?? 1
      page += 1
    } while (page <= totalPages)
  }

  return rows.map((row) => {
    const m = row.metrics ?? {}
    const engagementValues = map.engagementParts.map((k) => m[k]).filter((v): v is number => typeof v === 'number')
    return {
      date: String(row.dimensions['reporting_period.by(day)'] ?? row.dimensions['reporting_period'] ?? '').slice(0, 10),
      network,
      customerProfileId: Number(row.dimensions['customer_profile_id'] ?? 0),
      followers: pick(m, map.followers),
      netFollowerGrowth: pick(m, map.netFollowerGrowth),
      impressions: pick(m, map.impressions),
      reach: pick(m, map.reach),
      videoViews: pick(m, map.videoViews),
      engagements: engagementValues.length ? engagementValues.reduce((a, b) => a + b, 0) : null,
      postsSent: pick(m, map.postsSent),
    }
  }).filter((d) => d.date.length === 10)
}

/** Sent posts for one network across a date range. */
export async function fetchPosts(
  network: Network,
  profiles: SproutProfile[],
  from: string,
  to: string,
  maxPages = 4,
): Promise<SocialPost[]> {
  const map = NETWORK_POST_METRICS[network]
  if (!map || profiles.length === 0) return []

  const byId = new Map(profiles.map((p) => [p.customerProfileId, p]))
  const profileIds = profiles.map((p) => p.customerProfileId)
  const metrics = [
    map.impressions, map.views, map.videoViews, map.likes, map.comments, map.shares,
    ...map.extraEngagementParts,
  ].filter((m): m is string => Boolean(m))
  // De-duplicate: several fields legitimately point at the same metric name.
  const uniqueMetrics = [...new Set(metrics)]

  const BASE_FIELDS = ['created_time', 'perma_link', 'text', 'customer_profile_id']
  // visual_media carries the post thumbnail. It is documented on the Posts endpoint,
  // but plan and network coverage vary, so a 400 downgrades instead of failing.
  let fields = [...BASE_FIELDS, 'visual_media']

  const out: SocialPost[] = []
  let page = 1
  let totalPages = 1
  do {
    const body = () => ({
      fields,
      filters: [
        `customer_profile_id.eq(${profileIds.slice(0, 100).join(', ')})`,
        // created_time uses full ISO timestamps and a two-dot separator.
        `created_time.in(${from}T00:00:00..${to}T23:59:59)`,
      ],
      metrics: uniqueMetrics,
      page,
    })

    let res: SproutEnvelope<RawPost>
    try {
      res = await request<SproutEnvelope<RawPost>>('sprout', `${BASE()}/analytics/posts`,
        { method: 'POST', headers: AUTH(), body: body() })
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && fields.length > BASE_FIELDS.length) {
        console.warn(`[sprout] ${network}: visual_media rejected, retrying without thumbnails`)
        fields = BASE_FIELDS
        res = await request<SproutEnvelope<RawPost>>('sprout', `${BASE()}/analytics/posts`,
          { method: 'POST', headers: AUTH(), body: body() })
      } else {
        throw err
      }
    }
    for (const p of res.data ?? []) {
      const m = p.metrics ?? {}
      const profileId = Number(p.customer_profile_id ?? 0)
      const profile = byId.get(profileId)

      const likes = pick(m, map.likes)
      const comments = pick(m, map.comments)
      const shares = pick(m, map.shares)
      const extras = map.extraEngagementParts.map((k) => m[k]).filter((v): v is number => typeof v === 'number')
      const parts = [likes, comments, shares, ...extras].filter((v): v is number => typeof v === 'number')
      const engagements = parts.length ? parts.reduce((a, b) => a + b, 0) : null

      const impressions = pick(m, map.impressions)
      const views = pick(m, map.views)
      // Networks without an impressions metric still deserve a rate - fall back to views.
      const basis = impressions && impressions > 0
        ? (map.impressionsAreReach ? 'reach' as const : 'impressions' as const)
        : views && views > 0 ? 'views' as const : null
      const denominator = basis === 'views' ? views : basis == null ? null : impressions

      out.push({
        id: String(p.perma_link ?? `${profileId}-${p.created_time ?? ''}`),
        network,
        customerProfileId: profileId,
        accountName: profile?.name ?? 'Unknown account',
        accountHandle: profile?.nativeName ?? null,
        accountType: profile?.accountType ?? 'artist',
        createdAt: p.created_time ?? '',
        permalink: p.perma_link ?? null,
        text: p.text ?? '',
        ...pickMedia(p.visual_media),
        impressions,
        views,
        likes,
        comments,
        shares,
        engagements,
        videoViews: pick(m, map.videoViews),
        engagementRate: denominator && engagements != null ? engagements / denominator : null,
        engagementRateBasis: denominator && engagements != null ? basis : null,
      })
    }
    totalPages = res.paging?.total_pages ?? 1
    page += 1
  } while (page <= totalPages && page <= maxPages)

  return out
}

interface RawPost {
  text?: string
  perma_link?: string
  created_time?: string
  customer_profile_id?: number
  visual_media?: RawMedia[]
  metrics?: Record<string, number>
}

interface RawMedia {
  media_url?: string
  thumbnail_url?: string
  display_image_url?: string
  image_url?: string
  picture?: string
  media_type?: string
}

/**
 * Docs say visual_media carries "URLs for the full media, a high resolution display
 * image and a thumbnail", without pinning the key names, so prefer smallest first
 * and fall through.
 */
function pickMedia(media: RawMedia[] | undefined): { thumbnailUrl: string | null; mediaType: string | null } {
  const first = media?.[0]
  if (!first) return { thumbnailUrl: null, mediaType: null }
  const url = first.thumbnail_url ?? first.display_image_url ?? first.image_url
    ?? first.picture ?? first.media_url ?? null
  return { thumbnailUrl: url, mediaType: first.media_type ?? null }
}

function pick(metrics: Record<string, number>, key: string | null): number | null {
  if (!key) return null
  const v = metrics[key]
  return typeof v === 'number' ? v : null
}

export function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
