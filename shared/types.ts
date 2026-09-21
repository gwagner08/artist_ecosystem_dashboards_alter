/** Canonical types shared by the Express API and the React client. */

export type Network =
  | 'instagram' | 'tiktok' | 'youtube' | 'facebook'
  | 'twitter' | 'threads' | 'linkedin' | 'pinterest' | 'bluesky'

export type ProviderName = 'sprout' | 'chartmetric' | 'realcount'

/**
 * What an engagement rate was divided by.
 *
 * `reach` is unique viewers and the honest denominator. `impressions` double-counts
 * repeat viewers. `views` is a last resort for networks reporting neither - TikTok
 * exposes no reach metric at profile level, only total video views.
 */
export type EngagementBasis = 'reach' | 'impressions' | 'views'

/** Artist-owned accounts vs fan-run accounts, both inside the Sprout group. */
export type AccountType = 'artist' | 'fan'
/** What the dashboard is filtered to. 'all' is both. */
export type AccountFilter = AccountType | 'all'
/** Platform filter. 'all' is every network the artist has. */
export type NetworkFilter = Network | 'all'
export type ProviderMode = 'live' | 'fixtures' | 'unconfigured'

export interface ProviderStatus {
  provider: ProviderName
  mode: ProviderMode
  /** Human-readable reason when not live. */
  detail: string
}

/** A Sprout profile, after we've attached it to an artist. */
export interface SproutProfile {
  customerProfileId: number
  network: Network
  name: string
  nativeName: string | null
  link: string | null
  /** Sprout group IDs this profile belongs to - used to infer account type. */
  groups: number[]
  accountType: AccountType
  /** Which signal decided accountType, so a misclassification is visible. */
  accountTypeReason: 'config' | 'sprout-group' | 'name' | 'default'
  /** False when manually excluded from this artist's ecosystem. */
  included: boolean
  /** True when a manual override is what set accountType or included. */
  overridden: boolean
}

export interface Artist {
  /** URL-safe id, derived from the display name. */
  slug: string
  name: string
  profiles: SproutProfile[]
  chartmetricArtistId: number | null
  realcountArtistId: string | null
  /** RealCount books events under this name when it differs from `name`. */
  realcountArtistName: string | null
  /** True when the artist came from artists.json rather than Sprout profile names. */
  pinned: boolean
}

/** One day of profile-level social data, normalised across networks. */
export interface SocialDay {
  date: string           // YYYY-MM-DD
  network: Network
  customerProfileId: number
  followers: number | null
  netFollowerGrowth: number | null
  impressions: number | null
  /** Unique viewers, where the network reports it. */
  reach: number | null
  videoViews: number | null
  /** Sum of the reaction-style metrics this network exposes. See sprout.ts ENGAGEMENT_PARTS. */
  engagements: number | null
  postsSent: number | null
}

export interface SocialPost {
  id: string
  network: Network
  customerProfileId: number
  /** Denormalised so the posts grid can label and filter without a profile lookup. */
  accountName: string
  accountHandle: string | null
  accountType: AccountType
  createdAt: string
  permalink: string | null
  text: string
  /** From Sprout's `visual_media` field; null when unavailable or unsupported. */
  thumbnailUrl: string | null
  mediaType: string | null
  impressions: number | null
  views: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  engagements: number | null
  videoViews: number | null
  /**
   * engagements / impressions. Falls back to views as the denominator on networks
   * with no impressions metric, so the column is never blank for TikTok/YouTube.
   */
  engagementRate: number | null
  /** Which denominator the rate used, so the number is never ambiguous. */
  engagementRateBasis: EngagementBasis | null
}

/**
 * A manual correction to one Sprout profile, stored server-side and applied on
 * every read. This is the escape hatch for a misclassified or junk account.
 */
export interface AccountOverride {
  customerProfileId: number
  /** false removes the account from every number in that artist's ecosystem. */
  included?: boolean
  /** Forces the account type, overriding group membership and the name heuristic. */
  accountType?: AccountType
  /**
   * Attaches this profile to an artist by slug, beating every matching rule.
   * This is how an unassigned account gets adopted from the dashboard.
   */
  artistSlug?: string
  /** Display name, used when the assignment creates an artist not in the config. */
  artistName?: string
  note?: string
  updatedAt?: string
}

/** Chartmetric consumption time series. */
export interface StreamingPoint {
  date: string
  spotifyListeners: number | null
  spotifyFollowers: number | null
  spotifyPopularity: number | null
}

export interface ListenerCity {
  city: string
  region: string | null
  country: string
  listeners: number
  latitude: number | null
  longitude: number | null
}

/** RealCount box-office data. */
export interface LiveEvent {
  id: string
  name: string
  venue: string
  city: string
  region: string | null
  country: string
  /** From RealCount's Google Places lookup - used to join markets by distance. */
  latitude: number | null
  longitude: number | null
  capacity: number
  eventDate: string
  onSaleDate: string | null
  currency: string
  sold: number
  comps: number
  holds: number
  /**
   * RealCount's own percent_sold where present - it respects the event's comps and
   * holds settings. Falls back to sold / capacity. Clamped to [0, 1.5].
   */
  sellThrough: number
  soldOut: boolean
  /** RealCount has marked the count final; the number will not move again. */
  isFinal: boolean
  ticketLink: string | null
  /** Tickets sold in the trailing 7 days of the count history. */
  last7Sold: number
  daysToShow: number
}

/**
 * One tour market, joined to the streaming demand in that same city.
 * This is the join that makes the dashboard worth building: it answers
 * "where is listening demand failing to convert into ticket sales?"
 */
export interface MarketConversion {
  city: string
  country: string
  listeners: number | null
  capacity: number
  sold: number
  sellThrough: number
  /** Tickets sold per 1,000 monthly listeners in that city. Null without Chartmetric city data. */
  ticketsPer1kListeners: number | null
  events: string[]
  /** How the market was matched to Chartmetric listener geography. */
  matchedBy: 'coordinates' | 'name' | 'none'
  verdict: 'underconverting' | 'on-track' | 'underplayed' | 'unknown'
}

export interface MetricDelta {
  current: number | null
  previous: number | null
  /** Fractional change, e.g. 0.12 for +12%. Null when previous is null or zero. */
  changePct: number | null
}

/** Whether manual account corrections will survive a restart on this host. */
export interface OverrideStorage {
  writable: boolean
  path: string
  reason?: string
  /** True when the path looks ephemeral, so corrections are lost on redeploy. */
  ephemeral: boolean
}

/* ---------- UGC: what creators do with the artist's music ---------- */

/** One sound, and how much content has been made with it. */
export interface UgcSound {
  /** Chartmetric track id, used to drill into the videos using this sound. */
  trackId: number | null
  /** Platform sound id, when the track id is absent. */
  platformSoundId: string | null
  name: string
  isrc: string | null
  posts: number | null
  views: number | null
  likes: number | null
  comments: number | null
  engagementRate: number | null
  score: number | null
}

export type CreatorDimension = 'country' | 'age-gender' | 'category' | 'subcategory' | 'language'

export interface CreatorBreakdownRow {
  value: string
  label: string
  count: number
  share: number
  /** Split out of "25-34|female" so an age pyramid can be built from it. */
  ageGroup: string | null
  gender: string | null
  /** Change in creator count against the previous period. */
  delta: number | null
}

export interface CreatorBreakdown {
  dimension: CreatorDimension
  periodDays: number
  /** Influencers in the panel for this period - NOT all creators using the sounds. */
  total: number
  rows: CreatorBreakdownRow[]
}

/**
 * A creator from Chartmetric's tracked INFLUENCER panel.
 *
 * This is not everyone who used a sound. The endpoint is tiktok-influencer-stats /
 * tiktok-top-influencers - a curated subset Chartmetric classifies as influencers.
 * Treating it as total creator reach overstates coverage badly and understates
 * geographic spread, since the panel skews to large accounts in major markets.
 */
export interface UgcCreator {
  handle: string
  fullName: string | null
  followers: number | null
  isVerified: boolean
  country: string | null
  ageGroup: string | null
  gender: string | null
  categories: string[]
  engagementRate: number | null
  avgViews: number | null
  videoCount: number | null
  featuredTrack: string | null
}

/** One piece of user-generated content. */
export interface UgcVideo {
  videoId: string
  username: string | null
  title: string | null
  link: string | null
  createdAt: string | null
  views: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  followers: number | null
  viewsPercentChange: number | null
}

export interface ArtistUgc {
  /** False when the account's Chartmetric plan does not include UGC. */
  available: boolean
  /**
   * Sounds are ALL-TIME. Chartmetric's top-tracks endpoint has no date filter, so
   * the selected range cannot scope them - `windowDays` says what the range does
   * scope, and the UI states it rather than implying the whole tab is filtered.
   */
  sounds: UgcSound[]
  creators: UgcCreator[]
  breakdown: CreatorBreakdown | null
  /** Videos posted inside the selected range, across every sound. */
  recentVideos: UgcVideo[]
  /**
   * The influencer panel's own age, gender and language mix - the demographics card.
   * These are the influencers themselves, not their audiences.
   */
  demographics: {
    ageGender: CreatorBreakdownRow[]
    language: CreatorBreakdownRow[]
    total: number
  }
  /** The range expressed in days, which is what the UGC endpoints accept. */
  windowDays: number
  /** Totals across the sounds returned, for the Overview strip. */
  totals: { posts: number | null; views: number | null }
}

export interface ArtistEcosystem {
  artist: Omit<Artist, 'profiles'> & { profiles: SproutProfile[] }
  range: { from: string; to: string }
  /** The filters this payload was built under. */
  filters: { accountType: AccountFilter; network: NetworkFilter }
  /**
   * Profile counts for the whole artist, before filtering - so the toggle can show
   * how many accounts sit behind each option and disable an empty one.
   */
  accountCounts: { all: number; artist: number; fan: number; excluded: number }
  /** Networks the artist has profiles on, for the platform toggle. */
  availableNetworks: Network[]
  providers: ProviderStatus[]
  overrideStorage: OverrideStorage
  /** Warnings surfaced in the UI - a partial dashboard beats a blank one. */
  warnings: string[]
  social: {
    daily: SocialDay[]
    byNetwork: Array<{
      network: Network
      followers: MetricDelta
      impressions: MetricDelta
      reach: MetricDelta
      engagements: MetricDelta
      engagementRate: number | null
      /** Which denominator that rate used, since it differs per network. */
      engagementBasis: EngagementBasis | null
    }>
    /** Every post in range for the selected accounts, for the Posts tab. */
    posts: SocialPost[]
    topPosts: SocialPost[]
    /**
     * Blended engagement rate.
     *
     * The denominator is chosen per network, preferring REACH (unique viewers) over
     * impressions, because impressions counts the same person more than once and
     * flatters the rate. Networks with neither fall back to views, and a network
     * with no denominator at all is excluded from both sides of the ratio - counting
     * its engagements against another network's reach inflates the number badly.
     *
     * `bases` records which denominators went into it.
     */
    reach: {
      impressions: MetricDelta
      engagements: MetricDelta
      engagementRate: number | null
      previousEngagementRate: number | null
      /** Networks excluded from the ratio, so the UI can say so. */
      excludedNetworks: Network[]
      /** Which denominators went into the blended rate, so it is never ambiguous. */
      bases: EngagementBasis[]
    }
  }
  /**
   * Chartmetric and RealCount are artist-level: they are NOT scoped by the account
   * type filter, because fan accounts don't have their own streams or box office.
   * The UI says so whenever a filter is active.
   */
  streaming: {
    /** Which Chartmetric artist this data came from, and how it was chosen. */
    source: {
      artistId: number | null
      matchedBy: 'config' | 'name' | null
      /** Artist artwork from Chartmetric. */
      imageUrl: string | null
      coverUrl: string | null
      /** Offered when nothing matched confidently, so the right one can be pinned. */
      candidates: Array<{ id: number; name: string }>
    }
    series: StreamingPoint[]
    monthlyListeners: MetricDelta
    spotifyFollowers: MetricDelta
    /** Followers per listener - how much casual listening converts to committed fandom. */
    followerConversion: number | null
    cities: ListenerCity[]
  }
  ugc: ArtistUgc
  live: {
    events: LiveEvent[]
    totalSold: number
    totalCapacity: number
    markets: MarketConversion[]
  }
}

/** Why a roster looks the way it does - so the screen can explain rather than just be blank. */
export interface RosterDiagnostics {
  groupIds: number[]
  totalProfiles: number
  matchedProfiles: number
  /** network_type values we could not map, with how many profiles carried each. */
  skippedNetworks: Record<string, number>
  /** Profiles that matched no artist on an authoritative roster. */
  unassigned: Array<{ customerProfileId: number; name: string; network: Network }>
  /** Artists an unassigned profile can be attached to from the dashboard. */
  assignableArtists: Array<{ slug: string; name: string }>
  topGroups: Array<{ groupId: number; profiles: number }>
}

export interface RosterEntry {
  slug: string
  name: string
  imageUrl: string | null
  /** Null when Chartmetric could not be matched, which is why artwork is missing. */
  chartmetricArtistId: number | null
  /** Close-but-not-exact Chartmetric names, offered so the right one can be pinned. */
  chartmetricCandidates: Array<{ id: number; name: string }>
  networks: Network[]
  followers: number | null
  followerChangePct: number | null
  engagementRate: number | null
  monthlyListeners: number | null
  upcomingEvents: number
  sellThrough: number | null
}
