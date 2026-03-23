import Redis from 'ioredis'

if (!process.env['REDIS_URL']) {
  throw new Error('REDIS_URL environment variable is not set')
}

const redis = new Redis(process.env['REDIS_URL'], {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 200, 2000),
  lazyConnect: true,
})

redis.on('error', (err) => {
  console.error('Redis connection error:', err.message)
})

export default redis
