import 'dotenv/config'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'

const ArtistOverride = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
  /** Extra Sprout profile names that belong to this artist but don't match on name. */
  sproutProfileNames: z.array(z.string()).optional(),
  sproutProfileIds: z.array(z.number()).optional(),
  /** Profiles to force to fan-run, overriding every other signal. */
  fanProfileIds: z.array(z.number()).optional(),
  /** Profiles to force to artist-owned, overriding the name heuristic. */
  artistProfileIds: z.array(z.number()).optional(),
  chartmetricArtistId: z.number().nullable().optional(),
  realcountArtistId: z.string().nullable().optional(),
  /** RealCount filters events by artist name; set this when it differs from `name`. */
  realcountArtistName: z.string().optional(),
})

const ArtistsFile = z.object({
  artists: z.array(ArtistOverride).default([]),
  /** Profile names to exclude entirely (label accounts, test profiles). */
  excludeProfileNames: z.array(z.string()).default([]),
  /**
   * When the artists list is non-empty it is authoritative by default: only those
   * artists appear, and Sprout profiles that match none of them are reported as
   * unassigned rather than inventing a roster row.
   *
   * Set this true to also auto-create artists from unmatched profile names, which
   * is the behaviour when the list is empty.
   */
  allowUnlistedArtists: z.boolean().default(false),
})

export type ArtistOverride = z.infer<typeof ArtistOverride>

function loadArtistsFile() {
  const path = resolve(process.cwd(), process.env.ARTISTS_CONFIG ?? 'config/artists.json')
  if (!existsSync(path)) return { artists: [], excludeProfileNames: [], allowUnlistedArtists: false }
  try {
    return ArtistsFile.parse(JSON.parse(readFileSync(path, 'utf8')))
  } catch (err) {
    throw new Error(`Failed to parse ${path}: ${(err as Error).message}`)
  }
}

const num = (v: string | undefined) => (v && v.trim() !== '' ? Number(v) : undefined)

/**
 * A comma-separated list of IDs. A parent group can hold its profiles only in
 * sub-groups, so more than one ID is often what you actually want:
 *   SPROUT_GROUP_ID=1001,1002,1003
 */
const numList = (v: string | undefined): number[] =>
  (v ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n))

export const config = {
  port: num(process.env.PORT) ?? 8787,
  /** Serve the built SPA from dist/web instead of expecting the Vite dev server. */
  production: process.env.NODE_ENV === 'production',
  cacheTtlSeconds: num(process.env.CACHE_TTL_SECONDS) ?? 900,

  sprout: {
    token: process.env.SPROUT_API_TOKEN?.trim() || null,
    customerId: num(process.env.SPROUT_CUSTOMER_ID) ?? null,
    /**
     * The Alter Music Group group. Every profile outside it is ignored.
     * Accepts several IDs, comma-separated, for parent/sub-group setups.
     * An empty value reads every profile on the account.
     */
    groupIds: numList(process.env.SPROUT_GROUP_ID),
    groupName: process.env.SPROUT_GROUP_NAME?.trim() || 'Alter Music Group',
    /**
     * Optional sub-groups that separate artist-owned from fan-run accounts.
     * If your Sprout group already splits them this way, set these and the
     * classification stops guessing from names.
     */
    artistGroupId: num(process.env.SPROUT_ARTIST_GROUP_ID) ?? null,
    fanGroupId: num(process.env.SPROUT_FAN_GROUP_ID) ?? null,
    baseUrl: process.env.SPROUT_BASE_URL?.trim() || 'https://api.sproutsocial.com',
  },

  chartmetric: {
    refreshToken: process.env.CHARTMETRIC_REFRESH_TOKEN?.trim() || null,
    baseUrl: process.env.CHARTMETRIC_BASE_URL?.trim() || 'https://api.chartmetric.com/api',
  },

  realcount: {
    clientId: process.env.REALCOUNT_CLIENT_ID?.trim() || null,
    clientSecret: process.env.REALCOUNT_CLIENT_SECRET?.trim() || null,
    baseUrl: process.env.REALCOUNT_BASE_URL?.trim() || 'https://realcount.pro',
  },

  artistsFile: loadArtistsFile(),
} as const

/** Fixtures are the default whenever a provider has no credentials. */
export const useFixtures = {
  sprout: !(config.sprout.token && config.sprout.customerId),
  chartmetric: !config.chartmetric.refreshToken,
  realcount: !(config.realcount.clientId && config.realcount.clientSecret),
}
