/**
 * Artist-owned vs fan account classification.
 *
 * Sprout has no "account type" field, so this is inferred. Three signals, highest
 * confidence first - whichever fires first wins, and the reason is carried through
 * to the UI so a wrong call is visible rather than silently baked into a number:
 *
 *   1. config/artists.json     explicit fanProfileIds / artistProfileIds
 *   2. Sprout group membership SPROUT_FAN_GROUP_ID / SPROUT_ARTIST_GROUP_ID
 *   3. profile name            fan-page naming conventions
 *   4. default                 artist-owned
 *
 * Run `npm run verify:apis` to print how every profile was classified and by which
 * signal, then correct anything wrong in config/artists.json.
 */
import type { AccountType, SproutProfile } from '@shared/types.ts'

/**
 * Fan-page naming conventions. Deliberately conservative - a false "fan" is worse
 * than a missed one, because it silently removes the artist's real account from
 * the default view.
 */
const FAN_PATTERNS: RegExp[] = [
  /\bfan(s|page|pages|club|account|cam)?\b/i,
  /\bupdates?\b/i,
  /\bdaily\b/i,
  /\bnews\b/i,
  /\barchives?\b/i,
  /\bsource\b/i,
  /\bcharts?\b/i,
  /\btracker\b/i,
  /\bcrowd\b/i,
  /\bnation\b/i,
  /\barmy\b/i,
]

export interface ClassifyOptions {
  artistProfileIds?: Set<number>
  fanProfileIds?: Set<number>
  artistGroupId?: number | null
  fanGroupId?: number | null
}

export interface Classification {
  type: AccountType
  /** Which signal decided it, shown in the UI and by verify:apis. */
  reason: 'config' | 'sprout-group' | 'name' | 'default'
}

export function classifyProfile(
  profile: Pick<SproutProfile, 'customerProfileId' | 'name' | 'nativeName' | 'groups'>,
  opts: ClassifyOptions,
): Classification {
  const { customerProfileId: id } = profile

  if (opts.fanProfileIds?.has(id)) return { type: 'fan', reason: 'config' }
  if (opts.artistProfileIds?.has(id)) return { type: 'artist', reason: 'config' }

  const groups = profile.groups ?? []
  if (opts.fanGroupId != null && groups.includes(opts.fanGroupId)) return { type: 'fan', reason: 'sprout-group' }
  if (opts.artistGroupId != null && groups.includes(opts.artistGroupId)) return { type: 'artist', reason: 'sprout-group' }

  const haystack = `${profile.name ?? ''} ${profile.nativeName ?? ''}`
  if (FAN_PATTERNS.some((re) => re.test(haystack))) return { type: 'fan', reason: 'name' }

  return { type: 'artist', reason: 'default' }
}

export const FAN_PATTERN_SOURCES = FAN_PATTERNS.map((r) => r.source)

/**
 * The same markers as a single stripping pattern.
 *
 * The registry removes these before matching a profile to an artist, so
 * "Halcyon Grove Updates" folds into "Halcyon Grove" instead of becoming its own
 * roster entry. Without this every fan page shows up as a separate artist.
 */
export const FAN_TOKENS = /\b(fans?|fanpages?|fanclub|fanaccount|fancam|updates?|daily|news|archives?|source|charts?|tracker|crowd|nation|army)\b/gi
