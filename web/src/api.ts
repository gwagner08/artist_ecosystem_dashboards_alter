import type {
  AccountFilter, AccountType, ArtistEcosystem, CreatorBreakdown, CreatorDimension,
  NetworkFilter, ProviderStatus, RosterDiagnostics, RosterEntry, UgcVideo,
} from '@shared/types.ts'

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init)
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

const get = <T>(path: string) => send<T>(path)

export const getRoster = () =>
  get<{
    artists: RosterEntry[]
    providers: ProviderStatus[]
    range: { from: string; to: string }
    diagnostics: RosterDiagnostics | null
  }>('/roster')

export const getArtist = (
  slug: string, from: string, to: string,
  accountType: AccountFilter = 'all', network: NetworkFilter = 'all',
) =>
  get<ArtistEcosystem>(
    `/artist/${encodeURIComponent(slug)}?from=${from}&to=${to}&accountType=${accountType}&network=${network}`,
  )

/** Force an account's type, or drop it out of its artist's ecosystem. */
export const updateAccount = (
  profileId: number,
  patch: {
    included?: boolean
    accountType?: AccountType
    /** Attach this profile to an artist, creating one when artistName is given. */
    artistSlug?: string
    artistName?: string
    note?: string
  },
) =>
  send(`/accounts/${profileId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })

/** Drop the manual correction and fall back to the inferred classification. */
export const clearAccountOverride = (profileId: number) =>
  send(`/accounts/${profileId}`, { method: 'DELETE' })

/** Videos using one sound. A drill-down, so it is fetched only when opened. */
export const getSoundVideos = (
  trackId: string,
  opts: { platform: 'tiktok' | 'youtube'; type: string; bySoundId?: boolean; days?: number },
) =>
  get<{ platform: string; total: number | null; videos: UgcVideo[] }>(
    `/sound/${encodeURIComponent(trackId)}/videos?platform=${opts.platform}&type=${opts.type}` +
    (opts.bySoundId ? '&bySoundId=true' : '') +
    (opts.days ? `&days=${opts.days}` : ''),
  )

/** Creator breakdown for a dimension other than the one shipped with the artist. */
export const getCreatorBreakdown = (
  artistId: number, dimension: CreatorDimension, periodDays?: number,
) =>
  get<CreatorBreakdown | null>(
    `/artist-ugc/${artistId}/breakdown?dimension=${dimension}` +
    (periodDays ? `&periodDays=${periodDays}` : ''),
  )
