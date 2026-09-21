/**
 * Builds the artist roster.
 *
 * Sprout has no notion of "artist" - it has profiles in groups. We scope to the
 * Alter Music Group group, then fold that group's profiles into artists by matching
 * profile names, because a roster of 40 profiles is really ~14 artists x 3 networks.
 *
 * Name matching is a heuristic and it will get some edge cases wrong (an artist whose
 * TikTok handle is nothing like their Instagram name). config/artists.json is the
 * escape hatch: pin profiles to an artist explicitly, and attach the Chartmetric and
 * RealCount ids that Sprout knows nothing about.
 */
import { config, useFixtures } from './config.ts'
import { cached } from './cache.ts'
import { scanProfiles, type ProfileScan } from './clients/sprout.ts'
import { fixtureProfiles } from './fixtures/generate.ts'
import { classifyProfile, FAN_TOKENS } from './accountType.ts'
import { loadOverrides, overridesRevision } from './overrides.ts'
import type { AccountType, Artist, SproutProfile } from '@shared/types.ts'

/** A name that reads as two acts working together, not one artist under a variant name. */
const COLLABORATION = /(\band\b|&|\bx\b|\bvs\.?\b|\bfeat\.?\b|\bwith\b|\bpresents\b)/i

/** Words that appear in handles but carry no identity. */
const NOISE = /\b(official|music|band|the|hq|tv|worldwide|global|us|uk)\b/g

/**
 * Strip accents before dropping non-alphanumerics.
 *
 * Without this, "The Marias" folds to "marias" but "The Marias" written with an
 * acute accent folds to "maras" - the accented character is simply deleted - so the
 * same artist lands on two roster rows. Decomposing to NFD and removing the
 * combining marks keeps the base letters.
 */
function foldAccents(name: string): string {
  return name.normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

export function normalizeName(name: string): string {
  return foldAccents(name).toLowerCase().replace(NOISE, ' ').replace(/[^a-z0-9]+/g, '')
}

/**
 * The key a profile is grouped under. Fan-page markers are stripped so an artist's
 * fan accounts land on the same artist rather than becoming their own roster rows.
 */
export function artistKey(name: string): string {
  return normalizeName(name.replace(FAN_TOKENS, ' '))
}

/** Display name for an artist, preferring an owned profile over a fan page. */
function displayName(profiles: SproutProfile[]): string {
  const owned = profiles.find((p) => p.accountType === 'artist')
  if (owned) return owned.name
  return (profiles[0]?.name ?? 'Unknown').replace(FAN_TOKENS, ' ').replace(/\s+/g, ' ').trim()
}

export function slugify(name: string): string {
  return foldAccents(name).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'artist'
}

/** The raw scan, kept so the UI can explain an empty roster instead of just showing one. */
export async function scan(): Promise<ProfileScan> {
  if (useFixtures.sprout) {
    const profiles = fixtureProfiles()
    return { profiles, totalProfiles: profiles.length, skippedNetworks: {}, groupsSeen: {} }
  }
  return cached('sprout:profiles', config.cacheTtlSeconds, () => scanProfiles(config.sprout.groupIds))
}

export async function loadProfiles(): Promise<SproutProfile[]> {
  return (await scan()).profiles
}

/** Profiles that matched no artist on an authoritative roster. */
let lastUnassigned: SproutProfile[] = []
export const unassignedProfiles = () => lastUnassigned

/**
 * findArtist() runs this for every artist, so the roster screen was rebuilding it
 * once per artist. Cached on the overrides revision, so a change on the Accounts tab
 * still takes effect immediately.
 */
export async function buildRoster(): Promise<Artist[]> {
  return cached(`roster:artists:${overridesRevision()}`, config.cacheTtlSeconds, buildRosterUncached)
}

async function buildRosterUncached(): Promise<Artist[]> {
  const profiles = await loadProfiles()
  const { artists: overrides, excludeProfileNames, allowUnlistedArtists } = config.artistsFile

  const excluded = new Set(excludeProfileNames.map(normalizeName))
  const available = profiles.filter((p) => !excluded.has(normalizeName(p.name)))

  const manualOverrides = loadOverrides()
  const claimed = new Set<number>()
  const byArtist = new Map<string, Artist>()

  /*
   * Assignments made on the dashboard beat every matching rule. They are the most
   * explicit signal there is - somebody looked at the account and said who it
   * belongs to - so they are applied before any name matching runs.
   */
  const assignedTo = new Map<string, SproutProfile[]>()
  const assignedNames = new Map<string, string>()
  for (const p of available) {
    const slug = manualOverrides.get(p.customerProfileId)?.artistSlug
    if (!slug) continue
    assignedTo.set(slug, [...(assignedTo.get(slug) ?? []), p])
    const name = manualOverrides.get(p.customerProfileId)?.artistName
    if (name) assignedNames.set(slug, name)
    claimed.add(p.customerProfileId)
  }

  /**
   * Account type is decided per artist, because the config overrides that carry the
   * highest-confidence signal are scoped to an artist entry.
   */
  const classify = (profile: SproutProfile, o?: { fanProfileIds?: number[]; artistProfileIds?: number[] }): SproutProfile => {
    const { type, reason } = classifyProfile(profile, {
      fanProfileIds: new Set(o?.fanProfileIds ?? []),
      artistProfileIds: new Set(o?.artistProfileIds ?? []),
      artistGroupId: config.sprout.artistGroupId,
      fanGroupId: config.sprout.fanGroupId,
    })
    // A manual correction beats every inferred signal.
    const manual = manualOverrides.get(profile.customerProfileId)
    return {
      ...profile,
      accountType: manual?.accountType ?? type,
      accountTypeReason: manual?.accountType ? 'config' : reason,
      included: manual?.included ?? true,
      overridden: Boolean(manual && (manual.accountType !== undefined || manual.included !== undefined)),
    }
  }

  // 1. Listed artists claim their profiles first, so an explicit roster always wins.
  //
  //    Matching is deliberately looser than the auto-discovery path: the roster is a
  //    closed set the user curated, so "Julien Rose Baker" can safely be attached to
  //    "Julien Baker". Longest artist name wins, which keeps "King Alessi" off
  //    "Alessi Rose" when both are on the roster.
  const byLongestName = [...overrides].sort(
    (a, b) => normalizeName(b.name).length - normalizeName(a.name).length,
  )

  for (const o of byLongestName) {
    const slug = o.slug ?? slugify(o.name)
    const wantedIds = new Set(o.sproutProfileIds ?? [])
    const aliases = [o.name, ...(o.sproutProfileNames ?? [])].map(normalizeName).filter(Boolean)

    const mine = available.filter((p) => {
      if (claimed.has(p.customerProfileId)) return false
      if (wantedIds.has(p.customerProfileId)) return true
      const key = normalizeName(p.name)
      if (!key) return false

      // An explicit alias always wins - that is a human decision.
      if (aliases.some((a) => key === a)) return true

      // Fuzzy containment ("Julien Baker Updates", "Caamp, the band") is useful, but
      // must not quietly absorb a collaboration: "X and Y" contains "X" and is a
      // different act. Those need naming explicitly in sproutProfileNames.
      if (COLLABORATION.test(p.name)) return false
      return aliases.some((a) => a.length >= 4 && key.includes(a))
    })
    mine.forEach((p) => claimed.add(p.customerProfileId))

    byArtist.set(slug, {
      slug,
      name: o.name,
      profiles: [...mine, ...(assignedTo.get(slug) ?? [])].map((p) => classify(p, o)),
      chartmetricArtistId: o.chartmetricArtistId ?? null,
      realcountArtistId: o.realcountArtistId ?? null,
      realcountArtistName: o.realcountArtistName ?? null,
      pinned: true,
    })
  }

  // 2. Everything left folds together on its fan-marker-stripped profile name, so
  //    an artist's own accounts and their fan pages land on the same artist.
  const buckets = new Map<string, SproutProfile[]>()
  for (const p of available) {
    if (claimed.has(p.customerProfileId)) continue
    const key = artistKey(p.name)
    if (!key) continue
    buckets.set(key, [...(buckets.get(key) ?? []), classify(p)])
  }

  // 2b. An assignment can name an artist the config does not list - creating an
  //     artist from the dashboard - so those become roster rows of their own.
  for (const [slug, profiles] of assignedTo) {
    if (byArtist.has(slug)) continue
    const name = assignedNames.get(slug) ?? profiles[0]?.name ?? slug
    byArtist.set(slug, {
      slug,
      name,
      profiles: profiles.map((p) => classify(p)),
      chartmetricArtistId: null,
      realcountArtistId: null,
      realcountArtistName: null,
      pinned: true,
    })
  }

  // 3. An authoritative roster does not grow itself. Anything unmatched is reported
  //    so it can be assigned, rather than becoming a roster row nobody asked for.
  const rosterIsAuthoritative = overrides.length > 0 && !allowUnlistedArtists
  lastUnassigned = []

  for (const [key, profiles] of buckets) {
    const pinnedMatch = [...byArtist.values()].find((a) => a.pinned && artistKey(a.name) === key)
    if (pinnedMatch) {
      pinnedMatch.profiles.push(...profiles)
      continue
    }
    if (rosterIsAuthoritative) {
      lastUnassigned.push(...profiles)
      continue
    }
    const name = displayName(profiles)
    byArtist.set(slugify(name), {
      slug: slugify(name), name, profiles,
      chartmetricArtistId: null, realcountArtistId: null, realcountArtistName: null, pinned: false,
    })
  }

  return [...byArtist.values()]
    .filter((a) => a.profiles.length > 0 || a.pinned)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function findArtist(slug: string): Promise<Artist | null> {
  const roster = await buildRoster()
  return roster.find((a) => a.slug === slug) ?? null
}


export interface DuplicateSuggestion {
  keep: string
  merge: string
  reason: string
}

/**
 * Roster rows that look like the same artist under a differently-worded account name.
 *
 * These are only ever SUGGESTIONS. Merging automatically would be wrong often enough
 * to matter: "Julien Baker" and "Julien Baker and Torres" share every token of the
 * shorter name and are genuinely different acts. So collaboration-shaped names are
 * excluded, and everything else is offered for a human to confirm.
 */
export function findPossibleDuplicates(roster: Artist[]): DuplicateSuggestion[] {
  const out: DuplicateSuggestion[] = []
  const entries = roster.map((a) => ({ artist: a, key: artistKey(a.name) })).filter((e) => e.key)

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i]!
      const b = entries[j]!
      const [shortEntry, longEntry] = a.key.length <= b.key.length ? [a, b] : [b, a]

      if (shortEntry.key === longEntry.key) {
        out.push({ keep: shortEntry.artist.name, merge: longEntry.artist.name, reason: 'identical once normalised' })
        continue
      }
      // A short key is too easy to find inside a longer one by chance.
      if (shortEntry.key.length < 6) continue
      if (!longEntry.key.includes(shortEntry.key)) continue
      if (COLLABORATION.test(longEntry.artist.name)) continue

      out.push({
        keep: shortEntry.artist.name,
        merge: longEntry.artist.name,
        reason: `"${longEntry.artist.name}" contains "${shortEntry.artist.name}"`,
      })
    }
  }
  return out
}

/** Roster rows whose names read as collaborations - listed so they are a choice, not an accident. */
export function findCollaborations(roster: Artist[]): string[] {
  return roster.filter((a) => COLLABORATION.test(a.name)).map((a) => a.name)
}
