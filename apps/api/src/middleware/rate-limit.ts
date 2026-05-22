import rateLimit from 'express-rate-limit'

const isTestEnv = (): boolean => process.env['NODE_ENV'] === 'test'

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTestEnv,
})

export const aiGenerationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: 'AI generation rate limit reached. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTestEnv,
})

export const smsSendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,
  message: { error: 'SMS send rate limit reached.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTestEnv,
})

export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTestEnv,
})
