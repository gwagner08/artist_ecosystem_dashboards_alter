/**
 * `npm run verify:apis`
 *
 * Probes each provider with real credentials and reports what actually works.
 * This exists because the vendor docs could not be reached from the build
 * environment for Chartmetric, and because Sprout's profile
 * metrics vary by network and by plan - a metric your plan doesn't include
 * makes the entire request fail with a 400, so it pays to find out which.
 *
 * Nothing here writes to your account. It only reads.
 */
import { config, useFixtures } from './config.ts'
import { request, ApiError } from './http.ts'
import { NETWORK_PROFILE_METRICS, listClients, listGroups, scanProfiles } from './clients/sprout.ts'
import { fetchListenerCities, fetchSpotifyStats, resolveArtist, searchArtist } from './clients/chartmetric.ts'
import { fetchEvents, searchArtists } from './clients/realcount.ts'
import { buildRoster, findCollaborations, findPossibleDuplicates, unassignedProfiles } from './registry.ts'
import type { Network } from '@shared/types.ts'

const ok = (s: string) => console.log(`  \x1b[32mPASS\x1b[0m  ${s}`)
const bad = (s: string) => console.log(`  \x1b[31mFAIL\x1b[0m  ${s}`)
const skip = (s: string) => console.log(`  \x1b[90mSKIP\x1b[0m  ${s}`)
const head = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`)

const today = new Date().toISOString().slice(0, 10)
const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)

async function verifySprout() {
  head('Sprout Social')
  if (!config.sprout.token) return skip('SPROUT_API_TOKEN not set.')

  let clients: Array<{ customer_id: number; name: string }> = []
  try {
    clients = await listClients()
    ok(`GET /v1/metadata/client -> ${clients.map((c) => `${c.customer_id} (${c.name})`).join(', ')}`)
  } catch (err) { bad(`client endpoint: ${(err as Error).message}`); return }

  // The customer ID is discoverable from the call above, so a blank one is a
  // first-run state to guide, not an error to skip past.
  if (config.sprout.customerId == null) {
    console.log('\n  SPROUT_CUSTOMER_ID is not set yet. Put one of these in your .env:\n')
    for (const c of clients) console.log(`      SPROUT_CUSTOMER_ID=${c.customer_id}      # ${c.name}`)
    console.log('\n  Then run this again to see your groups and profiles.')
    return
  }
  if (!clients.some((c) => c.customer_id === config.sprout.customerId)) {
    bad(`SPROUT_CUSTOMER_ID=${config.sprout.customerId} is not in that list.`)
  }

  let groups: Array<{ group_id: number; name: string }> = []
  try {
    groups = await listGroups()
    ok(`GET /metadata/customer/groups -> ${groups.length} groups`)
    const wanted = config.sprout.groupIds
    const missing = wanted.filter((id) => !groups.some((g) => g.group_id === id))
    if (wanted.length === 0) {
      bad('SPROUT_GROUP_ID is not set, so every profile on the account is being read.')
    } else if (missing.length) {
      bad(`These SPROUT_GROUP_ID values do not exist: ${missing.join(', ')}`)
    } else {
      ok(`SPROUT_GROUP_ID -> ${wanted.map((id) => `${id} (${groups.find((g) => g.group_id === id)!.name})`).join(', ')}`)
    }
  } catch (err) { bad(`groups endpoint: ${(err as Error).message}`) }

  let scan: Awaited<ReturnType<typeof scanProfiles>>
  try {
    scan = await scanProfiles(config.sprout.groupIds)
  } catch (err) { bad(`profiles endpoint: ${(err as Error).message}`); return }

  const profiles = scan.profiles
  if (profiles.length) {
    ok(`${profiles.length} usable profiles (of ${scan.totalProfiles} on the account)`)
    const byNetwork = new Map<string, number>()
    for (const p of profiles) byNetwork.set(p.network, (byNetwork.get(p.network) ?? 0) + 1)
    for (const [n, c] of byNetwork) console.log(`          ${n.padEnd(12)} ${c}`)
  } else {
    bad(`0 usable profiles, out of ${scan.totalProfiles} on the account.`)
  }

  if (Object.keys(scan.skippedNetworks).length) {
    bad(`Skipped - unrecognised network_type values: ${
      Object.entries(scan.skippedNetworks).map(([n, c]) => `${n} (${c})`).join(', ')
    }`)
    console.log('          Send me these and they can be added to NETWORK_ALIASES.')
  }

  // The most common cause of an empty roster: profiles live in sub-groups, so the
  // parent group ID on its own matches nothing.
  if (profiles.length === 0 && scan.totalProfiles > 0) {
    console.log('\n  Groups that actually have profiles on them:\n')
    const rows = Object.entries(scan.groupsSeen)
      .map(([id, count]) => ({ id: Number(id), count, name: groups.find((g) => g.group_id === Number(id))?.name ?? '(unknown group)' }))
      .sort((a, b) => b.count - a.count)
    for (const r of rows) console.log(`      ${String(r.id).padEnd(12)} ${String(r.count).padStart(4)} profiles   ${r.name}`)
    console.log('\n  SPROUT_GROUP_ID accepts several IDs, comma-separated:')
    console.log(`      SPROUT_GROUP_ID=${rows.slice(0, 3).map((r) => r.id).join(',')}`)
  }

  // Probe each metric on its own so one unsupported name doesn't hide the rest.
  head('Sprout metric support (one probe per metric, per network)')
  const byNetwork = new Map<Network, number[]>()
  for (const p of profiles) byNetwork.set(p.network, [...(byNetwork.get(p.network) ?? []), p.customerProfileId])

  for (const [network, ids] of byNetwork) {
    const map = NETWORK_PROFILE_METRICS[network]
    const candidates = [map.followers, map.netFollowerGrowth, map.impressions, map.videoViews, map.postsSent, ...map.engagementParts]
      .filter((m): m is string => Boolean(m))
    const supported: string[] = []
    const rejected: string[] = []

    for (const metric of candidates) {
      try {
        await request('sprout', `${config.sprout.baseUrl}/v1/${config.sprout.customerId}/analytics/profiles`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.sprout.token}` },
          retries: 0,
          body: {
            filters: [`customer_profile_id.eq(${ids.slice(0, 5).join(', ')})`, `reporting_period.in(${monthAgo}...${today})`],
            metrics: [metric],
            page: 1,
          },
        })
        supported.push(metric)
      } catch (err) {
        rejected.push(err instanceof ApiError && err.status === 400 ? metric : `${metric} (${(err as Error).message.slice(0, 60)})`)
      }
    }
    console.log(`  ${network}`)
    if (supported.length) ok(`  supported: ${supported.join(', ')}`)
    if (rejected.length) bad(`  rejected:  ${rejected.join(', ')}  <- remove these from NETWORK_PROFILE_METRICS`)
  }

  head('Artist grouping and account classification')
  const roster = await buildRoster()
  ok(`${roster.length} artists from ${profiles.length} profiles`)
  console.log('\n  Check the artist/fan column below. Anything wrong is fixable on the')
  console.log('  Accounts tab, or in config/artists.json via fanProfileIds / artistProfileIds.\n')

  for (const a of roster) {
    const gaps = [a.chartmetricArtistId == null ? 'chartmetric id' : null].filter(Boolean)
    console.log(`  ${a.name}${gaps.length ? `   (missing: ${gaps.join(', ')})` : ''}`)
    for (const prof of a.profiles) {
      const flag = prof.included ? ' ' : 'x'
      console.log(
        `      [${flag}] ${prof.network.padEnd(10)} ${String(prof.customerProfileId).padEnd(10)}` +
        ` ${prof.accountType.padEnd(7)} (${prof.accountTypeReason})  ${prof.name}`,
      )
    }
  }

  const byName = roster.flatMap((a) => a.profiles).filter((p) => p.accountTypeReason === 'name')
  if (byName.length) {
    console.log(`\n  ${byName.length} profiles were called fan accounts from their name alone.`)
    console.log('  If your Sprout group already splits artist vs fan into sub-groups, set')
    console.log('  SPROUT_ARTIST_GROUP_ID and SPROUT_FAN_GROUP_ID and this stops guessing.')
  }
  const unassigned = unassignedProfiles()
  if (unassigned.length) {
    head('Profiles not on the roster')
    console.log('  These matched no artist in config/artists.json, so they are excluded.')
    console.log('  Add the artist, or add the profile name to that artist\'s sproutProfileNames.\n')
    for (const p of unassigned) {
      console.log(`      ${String(p.customerProfileId).padEnd(10)} ${p.network.padEnd(11)} ${p.name}`)
    }
  }

  const dupes = findPossibleDuplicates(roster)
  if (dupes.length) {
    head('Possible duplicate artists')
    console.log('  Same artist under differently-worded account names. Not merged')
    console.log('  automatically - confirm each one first.\n')
    for (const d of dupes) console.log(`      ${d.keep}  <-  ${d.merge}      (${d.reason})`)
    console.log('\n  To merge, add the second name to the first artist in config/artists.json:\n')
    console.log('      ' + JSON.stringify(
      dupes.slice(0, 3).map((d) => ({ name: d.keep, sproutProfileNames: [d.merge] })), null, 2,
    ).replace(/\n/g, '\n      '))
  }

  const collabs = findCollaborations(roster)
  if (collabs.length) {
    console.log(`\n  Kept separate because the name reads as a collaboration: ${collabs.join(', ')}`)
    console.log('  If any of those is really one artist, merge it in config/artists.json.')
  }

  const singletons = roster.filter((a) => a.profiles.length === 1 && !a.pinned)
  if (singletons.length) {
    console.log(`\n  ${singletons.length} artists matched only one profile. If any should have`)
    console.log('  more networks attached, pin them in config/artists.json.')
  }
}

async function verifyChartmetric() {
  head('Chartmetric')
  if (useFixtures.chartmetric) return skip('CHARTMETRIC_REFRESH_TOKEN not set.')

  try {
    const results = await searchArtist('Leon Bridges')
    ok(`POST /token + GET /search -> ${results.length} results`)
  } catch (err) { bad(`auth or search: ${(err as Error).message}`); return }

  const roster = await buildRoster()

  // Names are resolved automatically, so the useful check is which ones matched.
  head('Chartmetric artist matching')
  console.log('  Anything not matched exactly needs a chartmetricArtistId pinned in')
  console.log('  config/artists.json. Check the matched ones too - same-name acts exist.\n')

  let resolved: number | null = null
  for (const a of roster) {
    if (a.chartmetricArtistId != null) {
      ok(`${a.name.padEnd(26)} id ${a.chartmetricArtistId} (pinned in config)`)
      resolved ??= a.chartmetricArtistId
      continue
    }
    try {
      const match = await resolveArtist(a.name)
      if (match.artistId != null) {
        ok(`${a.name.padEnd(26)} id ${match.artistId} (matched by name)`)
        resolved ??= match.artistId
      } else if (match.candidates.length) {
        bad(`${a.name.padEnd(26)} no exact match. Closest: ${match.candidates.map((c) => `${c.name} (${c.id})`).join(', ')}`)
      } else {
        bad(`${a.name.padEnd(26)} nothing found on Chartmetric`)
      }
    } catch (err) {
      bad(`${a.name.padEnd(26)} ${(err as Error).message}`)
    }
  }

  if (resolved == null) return skip('No artist resolved to a Chartmetric ID, so the data endpoints were not tested.')

  head('Chartmetric data endpoints')
  const id = resolved
  try {
    const series = await fetchSpotifyStats(id, monthAgo, today)
    if (series.length) ok(`/artist/${id}/stat/spotify -> ${series.length} points, latest listeners ${series.at(-1)?.spotifyListeners}`)
    else bad(`/artist/${id}/stat/spotify returned no parseable points - check the key names in toSeries()`)
  } catch (err) { bad(`spotify stats: ${(err as Error).message}`) }

  try {
    const cities = await fetchListenerCities(id)
    if (cities.length) ok(`/artist/${id}/where-people-listen -> ${cities.length} cities, top: ${cities[0]?.city}`)
    else bad('where-people-listen returned no parseable cities - check the shape in fetchListenerCities()')
  } catch (err) { bad(`cities: ${(err as Error).message}`) }
}

async function verifyRealcount() {
  head('RealCount')
  if (useFixtures.realcount) return skip('REALCOUNT_CLIENT_ID / REALCOUNT_CLIENT_SECRET not set.')

  const roster = await buildRoster()

  try {
    const artists = await searchArtists({ name: roster[0]?.name ?? 'a' })
    ok(`GET /api/v2/artists/search -> reachable (${artists.length} results for "${roster[0]?.name ?? 'a'}")`)
  } catch (err) {
    bad(`auth or artist search: ${(err as Error).message}`)
    return
  }

  // RealCount filters events by artist NAME, so the useful check is which roster
  // names actually resolve to events - a name mismatch is the likely failure here.
  head('RealCount artist name matching')
  const from = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10)
  const to = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10)

  for (const a of roster) {
    const name = a.realcountArtistName ?? a.name
    try {
      const events = await fetchEvents(name, from, to, a.realcountArtistId)
      if (events.length) {
        const next = events.find((e) => e.daysToShow >= 0) ?? events.at(-1)!
        ok(`${a.name.padEnd(26)} ${String(events.length).padStart(3)} events   next: ${next.city} ${next.eventDate} ${Math.round(next.sellThrough * 100)}% sold`)
      } else {
        bad(`${a.name.padEnd(26)} no events matched the name "${name}"`)
      }
    } catch (err) {
      bad(`${a.name.padEnd(26)} ${(err as Error).message}`)
    }
  }

  console.log('\n  Any artist with no events is almost certainly a name mismatch, not an')
  console.log('  empty calendar. Set realcountArtistName in config/artists.json to the name')
  console.log('  RealCount books them under.')
}

async function main() {
  console.log('\nVerifying provider configuration against live credentials.')
  console.log('This only reads - nothing is written to any account.')
  await verifySprout()
  await verifyChartmetric()
  await verifyRealcount()
  console.log('\nDone.\n')
}

main().catch((err) => { console.error(err); process.exit(1) })
