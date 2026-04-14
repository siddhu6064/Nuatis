import * as Sentry from '@sentry/node'

export function initSentry(): void {
  const dsn = process.env['SENTRY_DSN']
  if (!dsn) {
    console.info('[sentry] SENTRY_DSN not set — monitoring disabled')
    return
  }

  Sentry.init({
    dsn,
    environment: process.env['NODE_ENV'] ?? 'development',
    tracesSampleRate: 0.1,
  })

  console.info('[sentry] initialized')
}

export { Sentry }
