import { Redis } from 'ioredis'

/**
 * Create a BullMQ-compatible IORedis connection.
 * BullMQ requires maxRetriesPerRequest: null — separate from the app Redis singleton.
 */
export function createBullMQConnection(): Redis {
  const url = process.env['REDIS_URL']
  if (!url) throw new Error('REDIS_URL environment variable is not set')

  return new Redis(url, {
    maxRetriesPerRequest: null,
    retryStrategy: (times: number) => Math.min(times * 200, 2000),
  })
}
