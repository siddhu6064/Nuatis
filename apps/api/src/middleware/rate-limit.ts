import rateLimit from 'express-rate-limit'
import type { Request } from 'express'
import type { AuthenticatedRequest } from '../lib/auth.js'

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

// Per-TENANT cap on manual SMS sends — mount AFTER requireAuth so tenantId is
// populated. Keyed by tenant (not IP) so one tenant's burst can't be spread
// across IPs and can't starve others.
export const smsSendTenantLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,
  message: { error: 'SMS send rate limit reached for your account. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTestEnv,
  keyGenerator: (req: Request) => (req as AuthenticatedRequest).tenantId ?? 'unauthenticated',
})

export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTestEnv,
})

export const sessionInitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many session requests. Try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTestEnv,
})

export const bookingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: 'Too many booking attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTestEnv,
})

export const giftCardBalanceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many balance lookups. Try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTestEnv,
})

export const triggerLinkLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many requests. Try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTestEnv,
})

export const phoneProvisionLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 2,
  message: { error: 'Phone provisioning limit reached for today.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTestEnv,
})
