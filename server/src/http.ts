export class ApiError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    readonly body: string,
    message?: string,
  ) {
    super(message ?? `${provider} responded ${status}: ${body.slice(0, 400)}`)
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: unknown
  /** Retries apply to 429 and 5xx only - a 400 means our request is wrong, not flaky. */
  retries?: number
  timeoutMs?: number
}

const RETRYABLE = new Set([429, 500, 502, 503, 504])

export async function request<T>(provider: string, url: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', headers = {}, body, retries = 3, timeoutMs = 30_000 } = opts

  let lastError: Error | null = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        method,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        if (RETRYABLE.has(res.status) && attempt < retries) {
          // Sprout returns 429 on the 60/min limit; back off rather than hammer it.
          await sleep(backoffMs(attempt, res.headers.get('Retry-After')))
          continue
        }
        throw new ApiError(provider, res.status, text)
      }
      return (await res.json()) as T
    } catch (err) {
      lastError = err as Error
      if (err instanceof ApiError) throw err
      if (attempt < retries) {
        await sleep(backoffMs(attempt, null))
        continue
      }
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError ?? new Error(`${provider}: request failed`)
}

function backoffMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 30_000)
  }
  return Math.min(1000 * 2 ** attempt, 16_000) + Math.random() * 250
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
