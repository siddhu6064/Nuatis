import { Redis } from 'ioredis'

/**
 * Create a BullMQ-compatible IORedis connection.
 * BullMQ requires maxRetriesPerRequest: null — separate from the app Redis singleton.
 */
export function createBullMQConnection(): Redis {
  const url = process.env['REDIS_URL']
  if (!url) throw new Error('REDIS_URL environment variable is not set')

  // REDIS-01: require TLS in production (ioredis only enables it for rediss://).
  if (process.env['NODE_ENV'] === 'production' && !url.startsWith('rediss://')) {
    console.error(
      '[redis] REDIS_URL must use rediss:// (TLS) in production. Got:',
      url.replace(/:\/\/.*@/, '://***@')
    )
    process.exit(1)
  }
  const tlsOptions = url.startsWith('rediss://') ? { tls: {} } : {}

  return new Redis(url, {
    ...tlsOptions,
    maxRetriesPerRequest: null,
    retryStrategy: (times: number) => Math.min(times * 200, 2000),
  })
}
