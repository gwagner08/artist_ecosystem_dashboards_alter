export function compact(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${(n / 1e9).toFixed(digits)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(digits)}M`
  if (abs >= 1e4) return `${(n / 1e3).toFixed(0)}K`
  if (abs >= 1e3) return `${(n / 1e3).toFixed(digits)}K`
  return Math.round(n).toLocaleString('en-US')
}

export const full = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('en-US')

export const pct = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`

export const signedPct = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`

export const money = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '—' : `$${compact(n)}`

export function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export const NETWORK_LABEL: Record<string, string> = {
  instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', facebook: 'Facebook',
  twitter: 'X', threads: 'Threads', linkedin: 'LinkedIn', pinterest: 'Pinterest', bluesky: 'Bluesky',
}

/**
 * Colour follows the entity, never its rank - a network keeps its slot even when
 * filtering removes the networks above it.
 */
const SLOTS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)']
const NETWORK_ORDER = ['instagram', 'tiktok', 'youtube', 'facebook', 'twitter', 'threads', 'linkedin', 'pinterest', 'bluesky']

export function networkColor(network: string): string {
  const i = NETWORK_ORDER.indexOf(network)
  // Past five networks on one chart, identity comes from the legend and table,
  // not from a generated hue.
  return i >= 0 && i < SLOTS.length ? SLOTS[i]! : 'var(--text-muted)'
}

/**
 * Clean axis ticks: 1 / 2 / 5 x 10^n, always running past `max`.
 *
 * The top tick doubles as the scale's upper bound, so it MUST be >= max - stopping
 * short silently clips every point above it out of the plot box.
 */
export function niceTicks(max: number, count = 5): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1]
  const raw = max / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  const out: number[] = []
  for (let v = 0; out.length < 40; v += step) {
    out.push(v)
    if (v >= max) break
  }
  return out
}
