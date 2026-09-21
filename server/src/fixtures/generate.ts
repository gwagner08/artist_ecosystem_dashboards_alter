/**
 * Deterministic demo data, so the dashboard is explorable before any API keys exist.
 *
 * The artists here are invented placeholders, deliberately prefixed "DEMO" - no real
 * roster, client or revenue data is embedded in this repo. Everything is generated
 * from a seeded PRNG, so the same slug always yields the same numbers.
 */
import type {
  ListenerCity, LiveEvent, Network, SocialDay, SocialPost, SproutProfile, StreamingPoint,
} from '@shared/types.ts'

/** Mirrors the shape RealCount's count history returns, for fixture generation. */
interface CountRow { date: string; sold: number; comps: number; holds: number }

/** mulberry32 - small, fast, deterministic. */
function rng(seed: string) {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const DEMO_ARTISTS = [
  { name: 'DEMO Halcyon Grove', networks: ['instagram', 'tiktok', 'youtube'] as Network[], fan: ['instagram', 'tiktok'] as Network[] },
  { name: 'DEMO Nova Vane', networks: ['instagram', 'tiktok'] as Network[], fan: ['tiktok'] as Network[] },
  { name: 'DEMO The Paper Kites Co', networks: ['instagram', 'youtube', 'twitter'] as Network[], fan: ['instagram'] as Network[] },
  { name: 'DEMO Junia Rae', networks: ['instagram', 'tiktok', 'youtube'] as Network[], fan: [] as Network[] },
  { name: 'DEMO Ferris & Cole', networks: ['instagram', 'facebook', 'youtube'] as Network[], fan: ['instagram', 'facebook'] as Network[] },
]

/** Group IDs the fixtures pretend to be in, mirroring a real Sprout sub-group split. */
export const FIXTURE_GROUPS = { root: 900_000, artist: 900_001, fan: 900_002 }

export function fixtureProfiles(): SproutProfile[] {
  const out: SproutProfile[] = []
  let id = 100_000
  for (const a of DEMO_ARTISTS) {
    for (const network of a.networks) {
      out.push({
        customerProfileId: ++id,
        network,
        name: a.name,
        nativeName: a.name.toLowerCase().replace(/[^a-z0-9]+/g, ''),
        link: null,
        groups: [FIXTURE_GROUPS.root, FIXTURE_GROUPS.artist],
        accountType: 'artist',
        accountTypeReason: 'default',
        included: true,
        overridden: false,
      })
    }
    // Fan pages carry a fan-page naming convention, so the name heuristic is
    // exercised by the demo data exactly as it would be on a real account.
    for (const network of a.fan) {
      out.push({
        customerProfileId: ++id,
        network,
        name: `${a.name} Updates`,
        nativeName: `${a.name.toLowerCase().replace(/[^a-z0-9]+/g, '')}updates`,
        link: null,
        groups: [FIXTURE_GROUPS.root, FIXTURE_GROUPS.fan],
        accountType: 'fan',
        accountTypeReason: 'name',
        included: true,
        overridden: false,
      })
    }
  }
  return out
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  const cur = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}

const NETWORK_WEIGHT: Partial<Record<Network, number>> = {
  instagram: 1, tiktok: 0.8, youtube: 0.35, facebook: 0.5, twitter: 0.3,
}

export function fixtureSocialDays(slug: string, profiles: SproutProfile[], from: string, to: string): SocialDay[] {
  const days = eachDay(from, to)
  const out: SocialDay[] = []

  for (const p of profiles) {
    const r = rng(`${slug}:${p.customerProfileId}`)
    const weight = (NETWORK_WEIGHT[p.network] ?? 0.4) * (p.accountType === 'fan' ? 0.12 : 1)
    let followers = Math.round((40_000 + r() * 260_000) * weight)
    // Slight upward drift with occasional viral spikes, so the charts have a story.
    const trend = 0.0006 + r() * 0.0022

    days.forEach((date, i) => {
      const viral = r() > 0.975 ? 6 + r() * 14 : 1
      const growth = Math.round(followers * trend * viral * (0.6 + r() * 0.9))
      followers += growth
      const hasImpressions = p.network !== 'tiktok' && p.network !== 'youtube'
      const impressions = hasImpressions ? Math.round(followers * (0.18 + r() * 0.5) * viral) : null
      // Reach is unique viewers, so always below impressions. TikTok reports none.
      const reachMetric = impressions != null && p.network !== 'tiktok'
        ? Math.round(impressions * (0.55 + r() * 0.3)) : null
      const reach = impressions ?? Math.round(followers * (0.4 + r() * 0.9) * viral)

      out.push({
        date,
        network: p.network,
        customerProfileId: p.customerProfileId,
        followers,
        netFollowerGrowth: growth,
        impressions,
        reach: reachMetric,
        videoViews: p.network === 'youtube' ? null : Math.round(reach * (0.5 + r() * 0.6)),
        engagements: Math.round(reach * (0.02 + r() * 0.045)),
        postsSent: i % 2 === 0 ? 1 : 0,
      })
    })
  }
  return out
}

const CAPTIONS = [
  'new one out now', 'tour dates just dropped', 'behind the scenes from the session',
  'thank you for tonight', 'writing camp, day three', 'vinyl pre-order is live',
  'rehearsals for the run', 'a demo from 2 years ago',
]

export function fixturePosts(slug: string, profiles: SproutProfile[], from: string, to: string): SocialPost[] {
  const days = eachDay(from, to)
  const out: SocialPost[] = []
  for (const p of profiles) {
    const r = rng(`${slug}:posts:${p.customerProfileId}`)
    for (let i = 0; i < days.length; i += 3) {
      const date = days[i]!
      // Posts must not be dated into the future, or the grid labels them "scheduled".
      if (new Date(`${date}T18:00:00Z`).getTime() > Date.now()) continue
      const scale = p.accountType === 'fan' ? 0.15 : 1
      const reach = Math.round((20_000 + r() * 900_000) * scale)
      // YouTube exposes no post-level impressions metric, so neither do the fixtures.
      const impressions = p.network === 'youtube' ? null : reach
      const views = Math.round(reach * (0.7 + r() * 0.6))
      const likes = Math.round(reach * (0.006 + r() * 0.035))
      const comments = Math.round(likes * (0.01 + r() * 0.05))
      const shares = Math.round(likes * (0.02 + r() * 0.09))
      const engagements = likes + comments + shares
      const basis = impressions && impressions > 0 ? 'impressions' as const : 'views' as const
      const denominator = basis === 'impressions' ? impressions! : views
      out.push({
        id: `${p.customerProfileId}-${date}`,
        network: p.network,
        customerProfileId: p.customerProfileId,
        accountName: p.name,
        accountHandle: p.nativeName,
        accountType: p.accountType,
        createdAt: `${date}T18:0${i % 6}:00Z`,
        permalink: null,
        text: CAPTIONS[Math.floor(r() * CAPTIONS.length)]!,
        thumbnailUrl: null,
        mediaType: null,
        impressions,
        views,
        likes,
        comments,
        shares,
        engagements,
        videoViews: views,
        engagementRate: denominator > 0 ? engagements / denominator : null,
        engagementRateBasis: denominator > 0 ? basis : null,
      })
    }
  }
  return out
}

export function fixtureStreaming(slug: string, from: string, to: string): StreamingPoint[] {
  const r = rng(`${slug}:spotify`)
  let listeners = Math.round(120_000 + r() * 3_400_000)
  let followers = Math.round(listeners * (0.15 + r() * 0.3))
  return eachDay(from, to).map((date) => {
    const drift = 1 + (r() - 0.46) * 0.02
    listeners = Math.max(1000, Math.round(listeners * drift))
    followers = Math.round(followers * (1 + (r() - 0.42) * 0.004))
    return {
      date,
      spotifyListeners: listeners,
      spotifyFollowers: followers,
      spotifyPopularity: Math.min(96, Math.round(40 + r() * 35)),
    }
  })
}

const MARKETS: Array<[string, string, string | null, number, number]> = [
  ['Los Angeles', 'US', 'CA', 34.05, -118.24], ['New York', 'US', 'NY', 40.71, -74.01],
  ['London', 'GB', null, 51.51, -0.13], ['Chicago', 'US', 'IL', 41.88, -87.63],
  ['Nashville', 'US', 'TN', 36.16, -86.78], ['Austin', 'US', 'TX', 30.27, -97.74],
  ['Toronto', 'CA', 'ON', 43.65, -79.38], ['Berlin', 'DE', null, 52.52, 13.40],
  ['Amsterdam', 'NL', null, 52.37, 4.90], ['Sydney', 'AU', 'NSW', -33.87, 151.21],
  ['Mexico City', 'MX', null, 19.43, -99.13], ['Seattle', 'US', 'WA', 47.61, -122.33],
  ['Denver', 'US', 'CO', 39.74, -104.99], ['Atlanta', 'US', 'GA', 33.75, -84.39],
  ['Manchester', 'GB', null, 53.48, -2.24], ['Paris', 'FR', null, 48.86, 2.35],
]

export function fixtureCities(slug: string): ListenerCity[] {
  const r = rng(`${slug}:cities`)
  return MARKETS.map(([city, country, region, latitude, longitude]) => ({
    city, country, region, latitude, longitude,
    listeners: Math.round(4_000 + r() * 190_000),
  })).sort((a, b) => b.listeners - a.listeners)
}

const VENUES = ['The Fonda', 'Webster Hall', 'O2 Forum', 'Thalia Hall', 'Brooklyn Steel', 'Paradiso', 'Metro', 'Emo\'s']

export function fixtureEvents(slug: string): LiveEvent[] {
  const r = rng(`${slug}:live`)
  const picks = MARKETS.filter(() => r() > 0.45).slice(0, 9)

  return picks.map(([city, country, region], i) => {
    const capacity = [600, 900, 1200, 1800, 2400, 3500][Math.floor(r() * 6)]!
    const daysOut = Math.round(-30 + r() * 150)
    const eventDate = new Date(Date.now() + daysOut * 86_400_000).toISOString().slice(0, 10)
    const onSale = new Date(Date.now() + (daysOut - 90) * 86_400_000).toISOString().slice(0, 10)
    // Sell-through spread deliberately wide so the conversion view has real signal.
    const target = Math.min(1.0, 0.25 + r() * 0.85)

    const counts: CountRow[] = []
    const weeks = 14
    for (let w = 0; w <= weeks; w++) {
      // Ticket sales are front-loaded at on-sale, then flat, then a walk-up spike.
      const t = w / weeks
      const curve = 0.45 * (1 - Math.exp(-6 * t)) + 0.55 * Math.pow(t, 3.2)
      const sold = Math.round(capacity * target * curve)
      counts.push({
        date: new Date(new Date(onSale).getTime() + w * 7 * 86_400_000).toISOString().slice(0, 10),
        sold,
        comps: Math.round(capacity * 0.02),
        holds: Math.round(capacity * 0.05 * (1 - t)),
      })
    }

    const latest = counts.at(-1)!
    const weekAgo = counts.at(-2)?.sold ?? 0
    const sellThrough = capacity > 0 ? Math.min(latest.sold / capacity, 1.5) : 0
    const marketCity = MARKETS.find((m) => m[0] === city)

    return {
      id: `${slug}-ev-${i}`,
      name: `${slug.replace(/-/g, ' ')} at ${VENUES[i % VENUES.length]}`,
      venue: VENUES[i % VENUES.length]!,
      city, region, country,
      latitude: marketCity?.[3] ?? null,
      longitude: marketCity?.[4] ?? null,
      capacity, eventDate, onSaleDate: onSale, currency: 'USD',
      sold: latest.sold,
      comps: latest.comps,
      holds: latest.holds,
      sellThrough,
      soldOut: sellThrough >= 0.99,
      isFinal: daysOut < 0,
      ticketLink: null,
      last7Sold: Math.max(latest.sold - weekAgo, 0),
      daysToShow: Math.round((new Date(`${eventDate}T00:00:00Z`).getTime() - Date.now()) / 86_400_000),
    } satisfies LiveEvent
  })
}
