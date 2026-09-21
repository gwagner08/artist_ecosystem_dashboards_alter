import type { ProviderStatus } from '@shared/types.ts'

const NAME: Record<string, string> = { sprout: 'Sprout Social', chartmetric: 'Chartmetric', realcount: 'RealCount' }

export function ProviderBanner({ providers, warnings = [] }: { providers: ProviderStatus[]; warnings?: string[] }) {
  const demo = providers.filter((p) => p.mode !== 'live')
  if (demo.length === 0 && warnings.length === 0) return null

  return (
    <div className="banner">
      {demo.length > 0 ? (
        <>
          <strong>Demo data: {demo.map((p) => NAME[p.provider] ?? p.provider).join(', ')}.</strong>{' '}
          Numbers on this screen are generated, not real. Add credentials to .env, then run{' '}
          <code>npm run verify:apis</code>.
          <ul>{demo.map((p) => <li key={p.provider}>{NAME[p.provider]}: {p.detail}</li>)}</ul>
        </>
      ) : null}
      {warnings.length > 0 ? (
        <ul style={{ marginTop: demo.length ? 8 : 0 }}>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      ) : null}
    </div>
  )
}
