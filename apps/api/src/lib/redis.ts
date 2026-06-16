import { Redis } from 'ioredis'

const redisUrl = process.env['REDIS_URL']
if (!redisUrl) {
  throw new Error('REDIS_URL environment variable is not set')
}

// REDIS-01: require TLS in production. ioredis only negotiates TLS for rediss://,
// so a plaintext URL would send BullMQ payloads (incl. PII) in the clear.
if (process.env['NODE_ENV'] === 'production' && !redisUrl.startsWith('rediss://')) {
  console.error(
    '[redis] REDIS_URL must use rediss:// (TLS) in production. Got:',
    redisUrl.replace(/:\/\/.*@/, '://***@')
  )
  process.exit(1)
}
const tlsOptions = redisUrl.startsWith('rediss://') ? { tls: {} } : {}

const redis = new Redis(redisUrl, {
  ...tlsOptions,
  maxRetriesPerRequest: 3,
  retryStrategy: (times: number) => Math.min(times * 200, 2000),
  lazyConnect: true,
})

redis.on('error', (err: Error) => {
  console.error('Redis connection error:', err.message)
})

export default redis
