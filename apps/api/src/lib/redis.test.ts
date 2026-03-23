import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env') })

describe('Redis connection', () => {
  it('connects and responds to ping', async () => {
    if (!process.env['REDIS_URL']) {
      console.warn('REDIS_URL not set — skipping')
      return
    }

    const Redis = (await import('ioredis')).default
    const redis = new Redis(process.env['REDIS_URL'], {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    })

    const result = await redis.ping()
    expect(result).toBe('PONG')

    await redis.quit()
  })

  it('can set and get a value', async () => {
    if (!process.env['REDIS_URL']) return

    const Redis = (await import('ioredis')).default
    const redis = new Redis(process.env['REDIS_URL'], {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    })

    await redis.set('nuatis:test', 'hello', 'EX', 10)
    const val = await redis.get('nuatis:test')
    expect(val).toBe('hello')

    await redis.del('nuatis:test')
    await redis.quit()
  })
})
