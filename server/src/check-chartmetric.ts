/**
 * `npm run check:chartmetric`
 *
 * Confirms the dashboard matched the RIGHT Chartmetric artist for every artist on
 * your roster, by running the SAME resolver the app uses - not a re-implementation
 * of it - and printing enough to eyeball each one.
 *
 * For each artist you get the Chartmetric name it landed on, its monthly listeners
 * and followers, and a link straight to that artist in Chartmetric. Open a few and
 * you know. Listener counts are the fastest tell: an artist you know does 200K
 * showing 40M means the match is wrong.
 *
 * Reads only.
 */
import { useFixtures } from './config.ts'
import { buildRoster } from './registry.ts'
import { getArtist, fetchLatestStats, resolveArtist, searchArtist } from './clients/chartmetric.ts'
import { mapLimit } from './concurrency.ts'

const bold = (s: string) => `\u001b[1m${s}\u001b[0m`
const red = (s: string) => `\u001b[31m${s}\u001b[0m`
const green = (s: string) => `\u001b[32m${s}\u001b[0m`
const yellow = (s: string) => `\u001b[33m${s}\u001b[0m`
const dim = (s: string) => `\u001b[90m${s}\u001b[0m`

const compact = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (Math.abs(n) >= 1e3) return `${Math.round(n / 1e3)}K`
  return String(Math.round(n))
}

type Verdict = 'pinned' | 'matched' | 'unmatched'

interface Row {
  rosterName: string
  slug: string
  verdict: Verdict
  cmId: number | null
  cmName: string | null
  monthlyListeners: number | null
  followers: number | null
  candidates: Array<{ id: number; name: string }>
}

async function main() {
  if (useFixtures.chartmetric) {
    console.log(red('\nCHARTMETRIC_REFRESH_TOKEN is not set, so there is nothing to check.\n'))
    process.exit(1)
  }

  const roster = await buildRoster()
  console.log(bold(`\nChecking ${roster.length} artists against Chartmetric`))
  console.log(dim('Running the same resolver the dashboard uses. Reads only.\n'))

  const rows = await mapLimit<typeof roster[number], Row>(roster, 4, async (artist) => {
    const base = {
      rosterName: artist.name,
      slug: artist.slug,
      candidates: [] as Array<{ id: number; name: string }>,
    }

    let cmId = artist.chartmetricArtistId
    let verdict: Verdict = cmId != null ? 'pinned' : 'unmatched'
    let candidates: Array<{ id: number; name: string }> = []

    if (cmId == null) {
      try {
        const match = await resolveArtist(artist.name)
        cmId = match.artistId
        candidates = match.candidates
        verdict = cmId != null ? 'matched' : 'unmatched'
      } catch (err) {
        console.log(red(`  ${artist.name}: lookup failed - ${(err as Error).message}`))
      }
    }

    if (cmId == null) {
      return { ...base, verdict, cmId: null, cmName: null, monthlyListeners: null, followers: null, candidates }
    }

    const [meta, stats] = await Promise.all([
      getArtist(cmId).catch(() => null),
      fetchLatestStats(cmId).catch(() => null),
    ])

    return {
      ...base,
      verdict,
      cmId,
      cmName: meta?.name ?? null,
      monthlyListeners: stats?.monthlyListeners ?? null,
      followers: stats?.followers ?? null,
      candidates,
    }
  })

  // ---- Anything suspicious first ------------------------------------------
  const problems: string[] = []

  // Two roster artists on one Chartmetric record means at least one is wrong.
  const byId = new Map<number, Row[]>()
  for (const r of rows) {
    if (r.cmId == null) continue
    byId.set(r.cmId, [...(byId.get(r.cmId) ?? []), r])
  }
  for (const [id, sharing] of byId) {
    if (sharing.length > 1) {
      problems.push(`Chartmetric artist ${id} is claimed by ${sharing.map((r) => r.rosterName).join(' AND ')} - at least one is wrong.`)
    }
  }

  // A name that came back different is the other common sign of a bad match.
  const normalize = (s: string) =>
    s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  for (const r of rows) {
    if (r.cmId == null || !r.cmName) continue
    if (normalize(r.cmName) !== normalize(r.rosterName)) {
      problems.push(`"${r.rosterName}" resolved to Chartmetric's "${r.cmName}" (${r.cmId}) - confirm that is the same act.`)
    }
  }

  if (problems.length) {
    console.log(bold(red('NEEDS A LOOK')))
    for (const p of problems) console.log(`  ${red('!')} ${p}`)
    console.log('')
  }

  // ---- The table ----------------------------------------------------------
  console.log(bold('ROSTER'))
  console.log(dim('  Listener counts are the fastest tell. Open the link for anything that'))
  console.log(dim('  looks off by an order of magnitude.\n'))

  const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n))
  console.log(dim(`  ${pad('ROSTER NAME', 24)} ${pad('CHARTMETRIC NAME', 24)} ${'LISTENERS'.padStart(10)} ${'FOLLOWERS'.padStart(10)}  LINK`))

  for (const r of [...rows].sort((a, b) => a.rosterName.localeCompare(b.rosterName))) {
    if (r.cmId == null) {
      console.log(`  ${red('✗')} ${pad(r.rosterName, 22)} ${dim('no Chartmetric match')}`)
      if (r.candidates.length) {
        console.log(dim(`      closest: ${r.candidates.map((c) => `${c.name} (${c.id})`).join(', ')}`))
      }
      continue
    }

    const nameMatches = r.cmName && normalize(r.cmName) === normalize(r.rosterName)
    const mark = r.verdict === 'pinned' ? green('P') : nameMatches ? green('✓') : yellow('?')
    const link = `https://app.chartmetric.com/artist/${r.cmId}`

    console.log(
      `  ${mark} ${pad(r.rosterName, 22)} ${pad(r.cmName ?? '(no name)', 24)}` +
      ` ${compact(r.monthlyListeners).padStart(10)} ${compact(r.followers).padStart(10)}  ${dim(link)}`,
    )
  }

  const matched = rows.filter((r) => r.cmId != null).length
  console.log('')
  console.log(`  ${matched} of ${rows.length} matched.` +
    `  ${green('✓')} name matches   ${green('P')} pinned in config   ${yellow('?')} name differs   ${red('✗')} no match`)

  // ---- Fixing --------------------------------------------------------------
  const wrong = rows.filter((r) => r.cmId == null || (r.cmName && normalize(r.cmName) !== normalize(r.rosterName)))
  if (wrong.length) {
    console.log('')
    console.log(bold('TO FIX ANY OF THESE'))
    console.log('  Find the artist in Chartmetric, take the number from its URL, and pin it')
    console.log('  in config/artists.json:\n')
    console.log('      { "name": "' + (wrong[0]?.rosterName ?? 'Artist Name') + '", "chartmetricArtistId": 123456 }\n')
    console.log(dim(`  Or search from here:  npm run check:chartmetric -- --search "artist name"`))
  }
  console.log('')
}

/** `-- --search "name"` looks a name up directly, for finding the right ID to pin. */
async function search(term: string) {
  console.log(bold(`\nChartmetric search: "${term}"\n`))
  const results = await searchArtist(term)
  if (results.length === 0) {
    console.log(red('  Nothing found.\n'))
    return
  }
  for (const a of results) {
    const stats = await fetchLatestStats(a.id).catch(() => null)
    console.log(
      `  ${String(a.id).padEnd(9)} ${a.name.padEnd(30)}` +
      ` ${compact(stats?.monthlyListeners).padStart(9)} listeners   ` +
      dim(`https://app.chartmetric.com/artist/${a.id}`),
    )
  }
  console.log('')
  console.log(dim('  Pin the right one as chartmetricArtistId in config/artists.json.\n'))
}

const args = process.argv.slice(2)
const searchIndex = args.indexOf('--search')

const run = searchIndex >= 0 && args[searchIndex + 1]
  ? search(args[searchIndex + 1]!)
  : main()

run.catch((err) => {
  console.error(red(`\n${(err as Error).message}\n`))
  process.exit(1)
})
