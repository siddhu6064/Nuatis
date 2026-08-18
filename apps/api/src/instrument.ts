// Sentry must be initialized before any instrumented module (express, http, ...)
// is imported, so this file is preloaded via `node --import ./instrument.js`
// rather than called from index.ts. See package.json dev/start scripts.
import 'dotenv/config'
import * as Sentry from '@sentry/node'

const dsn = process.env['SENTRY_DSN']

if (!dsn) {
  console.info('[sentry] SENTRY_DSN not set — monitoring disabled')
} else if (process.env['NODE_ENV'] !== 'production') {
  console.info('[sentry] non-production environment — monitoring disabled')
} else {
  Sentry.init({
    dsn,
    environment: process.env['NODE_ENV'],
    tracesSampleRate: 0.1,
  })

  console.info('[sentry] initialized')
}
