import express from 'express'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { api } from './routes.ts'
import { config, useFixtures } from './config.ts'
import { ApiError } from './http.ts'

const app = express()
app.use(express.json())
app.use('/api', api)

if (config.production) {
  const dist = resolve(process.cwd(), 'dist/web')
  if (existsSync(dist)) {
    app.use(express.static(dist))
    app.get('*', (_req, res) => res.sendFile(resolve(dist, 'index.html')))
  }
}

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err instanceof ApiError ? (err.status >= 400 && err.status < 500 ? err.status : 502) : 500
  console.error(`[error] ${err.message}`)
  res.status(status).json({ error: err.message })
})

app.listen(config.port, () => {
  const modes = Object.entries(useFixtures)
    .map(([k, v]) => `${k}=${v ? 'fixtures' : 'live'}`)
    .join('  ')
  console.log(`\n  Artist ecosystem API  http://localhost:${config.port}`)
  console.log(`  Providers: ${modes}`)
  if (Object.values(useFixtures).some(Boolean)) {
    console.log('  Running on demo data for at least one provider - see .env.example.\n')
  } else {
    console.log('')
  }
})
