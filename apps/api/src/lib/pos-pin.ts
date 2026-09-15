import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number
) => Promise<Buffer>

const KEY_LENGTH = 64

/**
 * Scrypt rather than bcrypt: this repo has no bcrypt or argon2 dependency,
 * because mobile-auth.ts delegates password checking to Supabase Auth. A PIN
 * cannot go through Supabase Auth, and Node ships scrypt in core — so this is
 * a correct KDF with no new dependency.
 *
 * Stored format: `scrypt$<saltHex>$<keyHex>`.
 */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const key = await scryptAsync(pin, salt, KEY_LENGTH)
  return `scrypt$${salt}$${key.toString('hex')}`
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const salt = parts[1] as string
  const expected = Buffer.from(parts[2] as string, 'hex')
  // A truncated or non-hex stored value yields a short buffer, and
  // timingSafeEqual throws on a length mismatch — reject before calling it.
  if (expected.length !== KEY_LENGTH) return false
  const actual = await scryptAsync(pin, salt, KEY_LENGTH)
  return timingSafeEqual(actual, expected)
}
