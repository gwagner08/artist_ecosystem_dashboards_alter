import { useState } from 'react'
import type { ArtistEcosystem, AccountType, SproutProfile } from '@shared/types.ts'
import { Card } from '../components/Tooltip.tsx'
import { clearAccountOverride, updateAccount } from '../api.ts'
import { NETWORK_LABEL, networkColor } from '../format.ts'

const REASON_LABEL: Record<SproutProfile['accountTypeReason'], string> = {
  config: 'set manually',
  'sprout-group': 'from Sprout group',
  name: 'from profile name',
  default: 'default',
}

/**
 * Manage which Sprout accounts count toward this artist, and fix a wrong
 * artist/fan call. Changes persist server-side and apply to every number.
 */
export function Accounts({ data, onChanged }: { data: ArtistEcosystem; onChanged: () => void }) {
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const profiles = [...data.artist.profiles].sort(
    (a, b) => a.accountType.localeCompare(b.accountType) || a.network.localeCompare(b.network) || a.name.localeCompare(b.name),
  )

  async function mutate(profileId: number, fn: () => Promise<unknown>) {
    setBusy(profileId)
    setError(null)
    try {
      await fn()
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const storage = data.overrideStorage

  return (
    <>
      {!storage.writable ? (
        <div className="banner">
          <strong>Changes here cannot be saved.</strong> {storage.path} is not writable
          {storage.reason ? ` (${storage.reason})` : ''}. Set <code>OVERRIDES_PATH</code> to a writable location.
        </div>
      ) : storage.ephemeral ? (
        <div className="banner">
          <strong>Changes here reset on redeploy.</strong> They are saved to <code>{storage.path}</code>,
          which is on an ephemeral filesystem. To keep them, mount a persistent disk and point{' '}
          <code>OVERRIDES_PATH</code> at it.
        </div>
      ) : null}

      {error ? <div className="banner"><strong>Could not save:</strong> {error}</div> : null}

      <Card
        title="Accounts in this ecosystem"
        caption={`${data.accountCounts.artist} artist-owned, ${data.accountCounts.fan} fan-run${
          data.accountCounts.excluded ? `, ${data.accountCounts.excluded} excluded` : ''
        }. Turning an account off removes it from every number on the other tabs. Account type is inferred — correct it here if it is wrong.`}
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Include</th><th>Account</th><th>Network</th>
                <th>Type</th><th>Why</th><th>Profile ID</th><th />
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.customerProfileId} className={p.included ? undefined : 'excluded'}>
                  <td>
                    <label className="switch" title={p.included ? 'Counted' : 'Excluded from all numbers'}>
                      <input
                        type="checkbox" checked={p.included} disabled={busy === p.customerProfileId}
                        onChange={(e) => mutate(p.customerProfileId, () =>
                          updateAccount(p.customerProfileId, { included: e.target.checked }))}
                      />
                      <span className="track" />
                    </label>
                  </td>
                  <td>
                    <strong>{p.name}</strong>
                    {p.nativeName ? <div className="reason">@{p.nativeName}</div> : null}
                  </td>
                  <td>
                    <span className="legend-swatch" style={{ background: networkColor(p.network), display: 'inline-block', marginRight: 6 }} />
                    {NETWORK_LABEL[p.network] ?? p.network}
                  </td>
                  <td>
                    <select
                      className="control" value={p.accountType} disabled={busy === p.customerProfileId}
                      aria-label={`Account type for ${p.name}`}
                      onChange={(e) => mutate(p.customerProfileId, () =>
                        updateAccount(p.customerProfileId, { accountType: e.target.value as AccountType }))}
                    >
                      <option value="artist">Artist-owned</option>
                      <option value="fan">Fan account</option>
                    </select>
                  </td>
                  <td className="reason">{REASON_LABEL[p.accountTypeReason]}</td>
                  <td className="num">{p.customerProfileId}</td>
                  <td>
                    {p.overridden ? (
                      <button
                        className="control" disabled={busy === p.customerProfileId}
                        onClick={() => mutate(p.customerProfileId, () => clearAccountOverride(p.customerProfileId))}
                      >
                        Reset
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {profiles.length === 0 ? (
                <tr><td colSpan={7} className="empty">No Sprout profiles matched this artist.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
