#!/usr/bin/env node
/**
 * sprout-keys.mjs — find the Sprout Social IDs you need for the dashboard.
 *
 * Standalone. No install, no dependencies, no repo. Needs Node 18 or newer.
 *
 *   node sprout-keys.mjs
 *
 * It asks for your Sprout API token (input is masked), then prints:
 *   - your customer ID
 *   - every group ID and name, so you can pick Mick Management
 *   - how many profiles are in each group, and which networks
 *   - a ready-to-paste .env block
 *
 * It only reads. Nothing is written to your Sprout account. The token is never
 * saved, logged, or sent anywhere except api.sproutsocial.com.
 *
 * Token: Sprout > Settings > Global Features > API > Generate API Token
 *        (your user needs the "API Permissions" permission)
 */

import { createInterface } from 'node:readline'
import { writeFileSync } from 'node:fs'

const BASE = 'https://api.sproutsocial.com'

const ESC = '\u001b'
const bold = (s) => `${ESC}[1m${s}${ESC}[0m`
const red = (s) => `${ESC}[31m${s}${ESC}[0m`
const green = (s) => `${ESC}[32m${s}${ESC}[0m`
const dim = (s) => `${ESC}[90m${s}${ESC}[0m`

const KEY_ENTER = ['\r', '\n']
const KEY_EOT = '\u0004'
const KEY_INT = '\u0003'
const KEY_BACKSPACE = ['\u007f', '\b']

/** Masked prompt, so the token never sits in your terminal scrollback. */
function askSecret(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin
    process.stdout.write(question)

    // Piped input (no TTY) can't be masked; fall back to plain readline.
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
      // A paste arrives as a single chunk, so walk it character by character.
      for (const ch of chunk) {
        if (KEY_ENTER.includes(ch) || ch === KEY_EOT) return finish()
        if (ch === KEY_INT) { process.stdout.write('\n'); process.exit(1) }
        if (KEY_BACKSPACE.includes(ch)) {
          if (buf) { buf = buf.slice(0, -1); process.stdout.write('\b \b') }
          continue
        }
        // Skip any other control characters a paste might carry in.
        if (ch < ' ') continue
        buf += ch
        process.stdout.write('*')
      }
    }
    stdin.on('data', onData)
  })
}

async function get(path, token) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const err = new Error(body.slice(0, 300))
    err.status = res.status
    throw err
  }
  return res.json()
}

function explain(status) {
  if (status === 401) {
    return [
      'That token was rejected (401).',
      '  - Check for a stray space or a missing character when pasting.',
      '  - Tokens can be invalidated in Sprout; generate a fresh one and retry.',
    ].join('\n')
  }
  if (status === 403) {
    return [
      'The token is valid but not allowed to read this (403).',
      '  - Your Sprout user likely lacks the "API Permissions" permission.',
      '  - An Account Owner can grant it under Settings > Global Features > API.',
    ].join('\n')
  }
  if (status === 429) return 'Rate limited (429). Sprout allows 60 requests/minute. Wait a minute and retry.'
  return `Sprout returned ${status}.`
}

async function main() {
  console.log(bold('\nSprout key finder'))
  console.log(dim('Reads only. Your token is not saved or sent anywhere but Sprout.\n'))

  const token = process.env.SPROUT_API_TOKEN
    || (await askSecret('Paste your Sprout API token (hidden as you type), then press Enter: '))

  if (!token) {
    console.log(red('\nNo token entered. Nothing to do.\n'))
    process.exit(1)
  }

  let clients
  try {
    clients = (await get('/v1/metadata/client', token)).data ?? []
  } catch (err) {
    console.log(red(`\n${explain(err.status)}`))
    if (err.message) console.log(dim(`\n${err.message}`))
    process.exit(1)
  }

  if (clients.length === 0) {
    console.log(red('\nThe token works, but it can see no Sprout customer accounts.\n'))
    process.exit(1)
  }

  console.log(green(`Token works. ${clients.length} customer account(s) visible.\n`))

  const lines = []
  const say = (s = '') => {
    console.log(s)
    // Strip colour codes so the saved copy is plain text.
    lines.push(s.replace(new RegExp(`${ESC}\\[\\d+m`, 'g'), ''))
  }

  for (const client of clients) {
    say(bold(`Customer ${client.customer_id} - ${client.name}`))

    let groups = []
    let profiles = []
    try {
      groups = (await get(`/v1/${client.customer_id}/metadata/customer/groups`, token)).data ?? []
      profiles = (await get(`/v1/${client.customer_id}/metadata/customer`, token)).data ?? []
    } catch (err) {
      say(red(`  Could not read groups or profiles: ${explain(err.status)}`))
      continue
    }

    say(dim(`  ${groups.length} groups, ${profiles.length} profiles total`))
    say('')
    say('  GROUP ID     PROFILES  NAME')

    const sorted = [...groups].sort((a, b) => a.name.localeCompare(b.name))

    // Several groups can contain "Mick" (a parent plus artist/fan sub-groups).
    // The parent is the shortest name, and the one to point at.
    const mick = groups
      .filter((g) => /mick/i.test(g.name))
      .sort((a, b) => a.name.length - b.name.length)[0]

    for (const g of sorted) {
      const mine = profiles.filter((p) => (p.groups ?? []).includes(g.group_id))
      const nets = [...new Set(mine.map((p) => p.network_type))].sort()
      const hint = mick && g.group_id === mick.group_id ? green('   <- probably this one') : ''
      say(`  ${String(g.group_id).padEnd(12)} ${String(mine.length).padStart(8)}  ${g.name}${hint}`)
      if (mine.length) say(dim(`  ${' '.repeat(22)}${nets.join(', ')}`))
    }
    say('')
    say(bold('  Paste this into your .env:'))
    say('')
    say('  SPROUT_API_TOKEN=<the token you just pasted>')
    say(`  SPROUT_CUSTOMER_ID=${client.customer_id}`)
    if (mick) {
      say(`  SPROUT_GROUP_ID=${mick.group_id}`)
      say(`  SPROUT_GROUP_NAME=${mick.name}`)
    } else {
      say('  SPROUT_GROUP_ID=<pick a GROUP ID from the table above>')
      say("  SPROUT_GROUP_NAME=<that group's name>")
    }
    say('')

    // A sub-group split by artist vs fan is worth surfacing: setting these stops the
    // dashboard guessing account type from profile names.
    const artistGroup = sorted.find((g) => /\bartists?\b|\bowned\b/i.test(g.name))
    const fanGroup = sorted.find((g) => /\bfans?\b/i.test(g.name))
    if (artistGroup || fanGroup) {
      say(bold('  Optional - these look like an artist/fan split:'))
      if (artistGroup) say(`  SPROUT_ARTIST_GROUP_ID=${artistGroup.group_id}   # ${artistGroup.name}`)
      if (fanGroup) say(`  SPROUT_FAN_GROUP_ID=${fanGroup.group_id}   # ${fanGroup.name}`)
      say('')
    }
  }

  try {
    writeFileSync('sprout-keys.txt', `${lines.join('\n')}\n`, 'utf8')
    console.log(dim('Saved a copy next to this script as sprout-keys.txt'))
    console.log(dim('(your token is NOT in that file).\n'))
  } catch {
    // A read-only directory is fine - the output above is the deliverable.
  }
}

main().catch((err) => {
  console.error(red(`\nUnexpected error: ${err.message}\n`))
  process.exit(1)
})
