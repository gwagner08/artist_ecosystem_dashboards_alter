/**
 * Manual per-account corrections, persisted as JSON.
 *
 * This is the escape hatch for when the automatic classification gets something
 * wrong: force an account's type, or drop it out of the artist's ecosystem
 * entirely (a dead account, a duplicate, a regional page skewing the totals).
 *
 * STORAGE: a single JSON file at OVERRIDES_PATH (default config/account-overrides.json).
 * On a host with an ephemeral filesystem - Render's default, for one - that file is
 * wiped on every deploy. Point OVERRIDES_PATH at a mounted disk to keep it, or the
 * corrections have to be redone after each deploy. `writable` on the status endpoint
 * reports whether the path can actually be written.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'
import type { AccountOverride } from '@shared/types.ts'

const OverrideSchema = z.object({
  customerProfileId: z.number(),
  included: z.boolean().optional(),
  accountType: z.enum(['artist', 'fan']).optional(),
  artistSlug: z.string().min(1).max(120).optional(),
  artistName: z.string().min(1).max(200).optional(),
  note: z.string().max(500).optional(),
  updatedAt: z.string().optional(),
})

const FileSchema = z.object({ overrides: z.array(OverrideSchema).default([]) })

const filePath = () => resolve(process.cwd(), process.env.OVERRIDES_PATH ?? 'config/account-overrides.json')

/** Cached in memory; the file is the durable copy, not the source of truth per read. */
let cache: Map<number, AccountOverride> | null = null

/**
 * Bumped whenever an override changes, so derived caches (the roster, which is built
 * from classified profiles) can key on it and refresh instead of going stale.
 */
let revision = 0
export const overridesRevision = () => revision

export function loadOverrides(): Map<number, AccountOverride> {
  if (cache) return cache
  const path = filePath()
  const map = new Map<number, AccountOverride>()
  if (existsSync(path)) {
    try {
      const parsed = FileSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
      for (const o of parsed.overrides) map.set(o.customerProfileId, o)
    } catch (err) {
      // A corrupt overrides file must not take the whole dashboard down.
      console.error(`[overrides] ignoring unreadable ${path}: ${(err as Error).message}`)
    }
  }
  cache = map
  return map
}

export function saveOverride(input: AccountOverride): AccountOverride {
  const parsed = OverrideSchema.parse({ ...input, updatedAt: new Date().toISOString() })
  const map = loadOverrides()
  const merged = { ...map.get(parsed.customerProfileId), ...stripUndefined(parsed) }
  map.set(parsed.customerProfileId, merged)
  revision += 1
  persist(map)
  return merged
}

export function clearOverride(customerProfileId: number): void {
  const map = loadOverrides()
  map.delete(customerProfileId)
  revision += 1
  persist(map)
}

function persist(map: Map<number, AccountOverride>) {
  const path = filePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ overrides: [...map.values()] }, null, 2)}\n`, 'utf8')
}

/** Whether corrections will actually survive - surfaced in the UI. */
export function overridesWritable(): { writable: boolean; path: string; reason?: string } {
  const path = filePath()
  try {
    mkdirSync(dirname(path), { recursive: true })
    const probe = `${path}.probe`
    writeFileSync(probe, 'ok')
    // Best-effort cleanup; an orphaned probe file is harmless.
    try { unlinkSync(probe) } catch { /* ignore */ }
    return { writable: true, path }
  } catch (err) {
    return { writable: false, path, reason: (err as Error).message }
  }
}

function stripUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T
}
