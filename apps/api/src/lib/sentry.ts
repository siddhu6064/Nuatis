import * as Sentry from '@sentry/node'

// Sentry.init() lives in src/instrument.ts, preloaded via `--import` so that
// auto-instrumentation can patch express/http before they are imported.
// This module only re-exports the SDK for manual capture calls.
export { Sentry }
