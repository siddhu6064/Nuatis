import { describe, it, expect } from '@jest/globals'
import { toCents, toDollars } from './money.js'

describe('toCents', () => {
  it('converts a dollar number', () => {
    expect(toCents(12.34)).toBe(1234)
  })

  it('converts a numeric string as returned by Postgres numeric columns', () => {
    expect(toCents('12.34')).toBe(1234)
  })

  it('rounds half away from zero rather than truncating', () => {
    expect(toCents(0.005)).toBe(1)
  })

  it('rounds a negative half away from zero too', () => {
    expect(toCents(-0.005)).toBe(-1)
  })

  it('survives the classic float case 0.1 + 0.2', () => {
    expect(toCents(0.1) + toCents(0.2)).toBe(30)
  })

  it('handles zero and whole dollars', () => {
    expect(toCents(0)).toBe(0)
    expect(toCents('5')).toBe(500)
  })

  it('handles a value whose float representation is just under the cent', () => {
    // 1.005 is actually 1.00499999... in binary float; naive truncation gives 100.
    expect(toCents(8.285)).toBe(829)
  })

  it('throws on a non-numeric string rather than silently yielding NaN', () => {
    expect(() => toCents('abc')).toThrow()
  })

  it('throws on Infinity', () => {
    expect(() => toCents(Infinity)).toThrow()
  })
})

describe('toDollars', () => {
  it('formats cents with two decimal places', () => {
    expect(toDollars(1234)).toBe('12.34')
  })

  it('pads single-digit cents', () => {
    expect(toDollars(5)).toBe('0.05')
  })

  it('formats zero', () => {
    expect(toDollars(0)).toBe('0.00')
  })

  it('formats a negative amount with a single leading minus', () => {
    expect(toDollars(-500)).toBe('-5.00')
  })

  it('formats a negative amount under a dollar', () => {
    expect(toDollars(-5)).toBe('-0.05')
  })

  it('round-trips with toCents', () => {
    expect(toCents(toDollars(98765))).toBe(98765)
  })

  it('round-trips a negative through toCents', () => {
    expect(toCents(toDollars(-1250))).toBe(-1250)
  })

  it('throws on non-integer cents — a fractional cent is a bug upstream', () => {
    expect(() => toDollars(12.5)).toThrow()
  })
})
