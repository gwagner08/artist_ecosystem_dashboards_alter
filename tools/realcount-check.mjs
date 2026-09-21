#!/usr/bin/env node
/**
 * realcount-check.mjs — see exactly what the RealCount ticket endpoints return.
 *
 * Standalone. No install, no dependencies, no repo. Needs Node 18 or newer.
 *
 *   node realcount-check.mjs                    # everything visible to your account
 *   node realcount-check.mjs "Leon Bridges"     # one artist
 *
 * Prints, for the events it can see:
 *   - the aggregate stats RealCount computes
 *   - one full raw event, so you can see every field it actually sends
 *   - FIELD COVERAGE: which fields are populated and which are always empty
 *   - the count history for one event, which is where sales velocity comes from
 *
 * Field coverage is the useful part. RealCount returns ~50 fields per event and
 * many are blank depending on how a show was set up, so this tells you which
 * numbers are real for your account rather than which ones exist in principle.
 *
 * Reads only. Nothing is written to your RealCount account. Credentials are never
 * saved or sent anywhere except realcount.pro.
 *
 * Credentials: https://realcount.pro/settings/account
 */

import { createInterface } from 'node:readline'
import { writeFileSync } from 'node:fs'

const BASE = process.env.REALCOUNT_BASE_URL || 'https://realcount.pro'

const ESC = '\u001b'
const bold = (s) => `${ESC}[1m${s}${ESC}[0m`
const red = (s) => `${ESC}[31m${s}${ESC}[0m`
const green = (s) => `${ESC}[32m${s}${ESC}[0m`
const dim = (s) => `${ESC}[90m${s}${ESC}[0m`

const KEY_ENTER = ['\r', '\n']
const KEY_EOT = '\u0004'
const KEY_INT = '\u0003'
const KEY_BACKSPACE = ['\u007f', '\b']

function askSecret(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin
    process.stdout.write(question)

    if (!stdin.isTTY) {
      const rl = createInterface({ input: stdin, output: process.stdout })
      rl.question('', (a) => { rl.close(); resolve(a.trim()) })
      return
    }

    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let buf = ''

    const finish = () => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.removeListener('data', onData)
      process.stdout.write('\n')
      resolve(buf.trim())
    }

    const onData = (chunk) => {
      for (const ch of chunk) {
        if (KEY_ENTER.includes(ch) || ch === KEY_EOT) return finish()
        if (ch === KEY_INT) { process.stdout.write('\n'); process.exit(1) }
        if (KEY_BACKSPACE.includes(ch)) {
          if (buf) { buf = buf.slice(0, -1); process.stdout.write('\b \b') }
          continue
        }
        if (ch < ' ') continue
        buf += ch
        process.stdout.write('*')
      }
    }
    stdin.on('data', onData)
  })
}

async function get(path, id, secret) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'x-client-id': id, 'x-client-secret': secret, Accept: 'application/json' },
  })
  const text = await res.text()
  if (!res.ok) {
    const err = new Error(text.slice(0, 400))
    err.status = res.status
    throw err
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Response was not JSON: ${text.slice(0, 200)}`)
  }
}

function explain(status) {
  if (status === 401) {
    return [
      'Credentials rejected (401).',
      '  - Check for a stray space when pasting either value.',
      '  - Confirm both at https://realcount.pro/settings/account',
    ].join('\n')
  }
  if (status === 403) return 'Authenticated but not permitted (403). Your RealCount user may not have API access.'
  if (status === 404) return 'Endpoint not found (404). The API path may differ for your account.'
  return `RealCount returned ${status}.`
}

/** Both shapes appear in the spec: a bare array, and { items: [...] }. */
function rows(payload) {
  const d = payload?.data
  if (Array.isArray(d)) return d
  if (Array.isArray(d?.items)) return d.items
  return []
}

const isEmpty = (v) => v === null || v === undefined || v === '' ||
  (Array.isArray(v) && v.length === 0)

async function main() {
  const artistFilter = process.argv.slice(2).find((a) => !a.startsWith('--'))

  console.log(bold('\nRealCount endpoint inspector'))
  console.log(dim(`${BASE} — reads only, nothing is written.\n`))

  const clientId = process.env.REALCOUNT_CLIENT_ID
    || (await askSecret('Paste your RealCount client ID (hidden), then Enter:     '))
  const clientSecret = process.env.REALCOUNT_CLIENT_SECRET
    || (await askSecret('Paste your RealCount client secret (hidden), then Enter: '))

  if (!clientId || !clientSecret) {
    console.log(red('\nBoth values are needed. Nothing to do.\n'))
    process.exit(1)
  }

  const out = []
  const say = (s = '') => {
    console.log(s)
    out.push(s.replace(new RegExp(`${ESC}\\[\\d+m`, 'g'), ''))
  }

  // ---- Aggregate stats -----------------------------------------------------
  say(bold('AGGREGATE STATS  /api/v2/events/stats'))
  const statsQuery = new URLSearchParams({ top: '5', sort: 'total_count', order: 'desc' })
  if (artistFilter) statsQuery.set('artist', artistFilter)
  try {
    const stats = await get(`/api/v2/events/stats?${statsQuery}`, clientId, clientSecret)
    const d = stats?.data ?? stats
    say(green('  Reachable.'))
    say(`  ${JSON.stringify(d, null, 2).replace(/\n/g, '\n  ')}`)
  } catch (err) {
    say(red(`  ${explain(err.status)}`))
    if (err.message) say(dim(`  ${err.message.slice(0, 300)}`))
    if (err.status === 401) { finish(out); process.exit(1) }
  }
  say('')

  // ---- Events --------------------------------------------------------------
  //
  // /api/v2/events sorts performance_date ASCENDING, so a plain first page is an
  // account's OLDEST shows. Judging field coverage from those is misleading:
  // historic imports carry no gross, no timezone and no venue category, which reads
  // as "this account has no gross" when recent shows have it.
  //
  // So sample upcoming shows and recently-counted ones, and show the oldest page
  // separately for contrast.
  say(bold('EVENTS  /api/v2/events'))

  const fetchEvents = async (extra) => {
    const q = new URLSearchParams({ limit: '100', ...extra })
    if (artistFilter) q.set('artist', artistFilter)
    const payload = await get(`/api/v2/events?${q}`, clientId, clientSecret)
    return { rows: rows(payload), meta: payload?.meta }
  }

  let events = []
  let oldest = []
  try {
    const monthsAgo = new Date(Date.now() - 180 * 86_400_000).toISOString()
    const [up, recent, first] = await Promise.all([
      fetchEvents({ upcoming: 'true' }),
      fetchEvents({ updated_since: monthsAgo }),
      fetchEvents({}),
    ])

    const byId = new Map()
    for (const e of [...up.rows, ...recent.rows]) if (e?.id) byId.set(e.id, e)
    events = [...byId.values()]
    oldest = first.rows

    say(green(`  ${up.rows.length} upcoming, ${recent.rows.length} counted in the last 180 days`))
    say(green(`  ${events.length} unique recent/upcoming events${artistFilter ? ` for "${artistFilter}"` : ''}`))
    say(dim(`  ${oldest.length} on the default first page, which is the OLDEST shows`))
    if (first.meta) say(dim(`  default order: ${JSON.stringify(first.meta.order ?? {})}, has_more: ${first.meta.has_more}`))

    if (events.length === 0 && oldest.length > 0) {
      say(dim('\n  Nothing recent or upcoming, so falling back to the oldest page.'))
      events = oldest
    }
  } catch (err) {
    say(red(`  ${explain(err.status)}`))
    if (err.message) say(dim(`  ${err.message.slice(0, 300)}`))
    finish(out)
    process.exit(1)
  }

  if (events.length === 0) {
    say('')
    say('  No events came back. If you expected some:')
    say('    - the artist filter matches on NAME, partially and case-insensitively,')
    say('      so try a shorter fragment, or run with no argument to see everything')
    say('    - cancelled and archived events are still returned here, so an empty')
    say('      result means the account genuinely has none in scope')
    finish(out)
    return
  }

  // ---- One full raw event --------------------------------------------------
  say('')
  say(bold('ONE RAW EVENT  (every field, exactly as sent)'))
  say(`  ${JSON.stringify(events[0], null, 2).replace(/\n/g, '\n  ')}`)

  // ---- Field coverage ------------------------------------------------------
  say('')
  say(bold(`FIELD COVERAGE  across ${events.length} recent/upcoming events`))
  say(dim('  How often each field carries a value. The empty ones are the numbers'))
  say(dim('  you cannot rely on, whatever the docs say. Measured on recent shows,'))
  say(dim('  because historic imports are sparse and would understate coverage.\n'))

  const keys = [...new Set(events.flatMap((e) => Object.keys(e)))].sort()
  const coverage = keys.map((key) => {
    const filled = events.filter((e) => !isEmpty(e[key])).length
    const sample = events.find((e) => !isEmpty(e[key]))?.[key]
    return { key, filled, pct: Math.round((filled / events.length) * 100), sample }
  })

  const show = (label, list) => {
    if (list.length === 0) return
    say(`  ${label}`)
    for (const c of list) {
      const sample = typeof c.sample === 'object' ? JSON.stringify(c.sample) : String(c.sample ?? '')
      say(`      ${c.key.padEnd(30)} ${String(c.pct).padStart(3)}%   ${sample.slice(0, 44)}`)
    }
    say('')
  }

  show('ALWAYS POPULATED', coverage.filter((c) => c.pct === 100))
  show('SOMETIMES POPULATED', coverage.filter((c) => c.pct > 0 && c.pct < 100))
  show('ALWAYS EMPTY', coverage.filter((c) => c.pct === 0))

  // ---- What the dashboard reads -------------------------------------------
  say(bold('WHAT THE DASHBOARD USES'))
  const NEEDED = {
    capacity: 'show capacity',
    total_count: 'tickets sold',
    percent_sold: 'sell-through',
    performance_date: 'show date',
    venue_name: 'venue',
    city: 'market',
    google_places_lat: 'market join to listener geography',
    google_places_long: 'market join to listener geography',
    onsale_date: 'on-sale date',
    sold_out: 'sold-out flag',
  }
  for (const [key, what] of Object.entries(NEEDED)) {
    const c = coverage.find((x) => x.key === key)
    const label = `${key.padEnd(22)} ${what}`
    if (!c) say(red(`  MISSING  ${label}   — field not returned at all`))
    else if (c.pct === 0) say(red(`  EMPTY    ${label}`))
    else if (c.pct < 100) say(dim(`  PARTIAL  ${label}   ${c.pct}%`))
    else say(green(`  OK       ${label}`))
  }

  // ---- Recent vs historic -------------------------------------------------
  if (oldest.length > 0 && oldest !== events) {
    const oldCoverage = (key) => {
      const filled = oldest.filter((e) => !isEmpty(e[key])).length
      return Math.round((filled / oldest.length) * 100)
    }
    const diffs = coverage
      .map((c) => ({ key: c.key, recent: c.pct, historic: oldCoverage(c.key) }))
      .filter((d) => Math.abs(d.recent - d.historic) >= 30)

    if (diffs.length) {
      say(bold('RECENT vs HISTORIC'))
      say(dim('  Fields present on recent shows but not on the oldest imports. Worth'))
      say(dim('  knowing before anyone totals a number across all time.\n'))
      for (const d of diffs) {
        say(`      ${d.key.padEnd(30)} recent ${String(d.recent).padStart(3)}%   historic ${String(d.historic).padStart(3)}%`)
      }
      say('')
    }
  }

  // ---- Scale / presale breakdown ------------------------------------------
  const withDefinition = events.find((e) => e.latest_count_definition)
  if (withDefinition) {
    say(bold('SCALE BREAKDOWN  latest_count_definition'))
    say(dim('  A JSON string keyed by ticketing platform, then by scale. Where a'))
    say(dim('  promoter reports presales separately this is the only place that split'))
    say(dim('  appears - the dashboard does not read it yet.\n'))
    try {
      const parsed = JSON.parse(withDefinition.latest_count_definition)
      for (const [platform, scales] of Object.entries(parsed)) {
        say(`      ${platform}`)
        for (const [scale, v] of Object.entries(scales ?? {})) {
          say(`          ${scale.padEnd(22)} count ${String(v?.count ?? '—').padStart(7)}   gross ${v?.gross ?? '—'}`)
        }
      }
    } catch {
      say(dim('      Could not parse it as JSON.'))
    }
    say('')
  }

  // ---- Count history ------------------------------------------------------
  const withId = events.find((e) => e.id)
  if (withId) {
    say('')
    say(bold(`COUNT HISTORY  /api/v2/counts/${withId.id}`))
    say(dim('  This is where sales velocity comes from. Sub-count rows are per-scale'))
    say(dim('  and would double-count against the event-level row.\n'))
    try {
      const payload = await get(`/api/v2/counts/${encodeURIComponent(withId.id)}?limit=10`, clientId, clientSecret)
      const counts = rows(payload)
      say(`  ${counts.length} count rows (newest first)`)
      const subcounts = counts.filter((c) => c.is_subcount).length
      say(`  ${subcounts} of them are sub-counts, which the dashboard excludes`)
      say('')
      say(`  ${JSON.stringify(counts.slice(0, 3), null, 2).replace(/\n/g, '\n  ')}`)
    } catch (err) {
      say(red(`  ${explain(err.status)}`))
      if (err.message) say(dim(`  ${err.message.slice(0, 300)}`))
    }
  }

  // ---- Artist names -------------------------------------------------------
  say('')
  say(bold('ARTIST NAMES AS REALCOUNT SPELLS THEM'))
  say(dim('  Events are filtered by name, so these must match your roster.\n'))
  const names = new Set()
  for (const e of events) {
    const raw = e.artist_names
    const list = Array.isArray(raw) ? raw : String(raw ?? '').split(',')
    for (const n of list) if (n && n.trim()) names.add(n.trim())
  }
  for (const n of [...names].sort()) say(`      ${n}`)
  say('')
  say('  Any roster name not in this list needs realcountArtistName in')
  say('  config/artists.json set to the spelling above.')

  finish(out)
}

function finish(out) {
  try {
    writeFileSync('realcount-check.txt', `${out.join('\n')}\n`, 'utf8')
    console.log(dim('\nSaved a copy next to this script as realcount-check.txt'))
    console.log(dim('(your credentials are NOT in that file).\n'))
  } catch {
    // Read-only directory is fine - the output above is the deliverable.
  }
}

main().catch((err) => {
  console.error(red(`\nUnexpected error: ${err.message}\n`))
  process.exit(1)
})
