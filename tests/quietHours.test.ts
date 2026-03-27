import { describe, expect, it } from 'bun:test'
import { isQuietHours, parseTimeHour } from '../src/lib/quietHours'

describe('isQuietHours — overnight range (22:00–07:00)', () => {
  it('returns true at 23:00', ()  => expect(isQuietHours(22, 7, 23)).toBe(true))
  it('returns true at 00:00', ()  => expect(isQuietHours(22, 7, 0)).toBe(true))
  it('returns true at 06:00', ()  => expect(isQuietHours(22, 7, 6)).toBe(true))
  it('returns false at 07:00', () => expect(isQuietHours(22, 7, 7)).toBe(false))
  it('returns false at 12:00', () => expect(isQuietHours(22, 7, 12)).toBe(false))
  it('returns true at 22:00', ()  => expect(isQuietHours(22, 7, 22)).toBe(true))
})

describe('isQuietHours — daytime range (09:00–17:00)', () => {
  it('returns false at 08:00', () => expect(isQuietHours(9, 17, 8)).toBe(false))
  it('returns true at 09:00', ()  => expect(isQuietHours(9, 17, 9)).toBe(true))
  it('returns true at 12:00', ()  => expect(isQuietHours(9, 17, 12)).toBe(true))
  it('returns false at 17:00', () => expect(isQuietHours(9, 17, 17)).toBe(false))
})

describe('isQuietHours — edge cases', () => {
  it('returns false when start equals end', () => expect(isQuietHours(9, 9, 9)).toBe(false))
})

describe('parseTimeHour', () => {
  it('parses "22:00:00" to 22', () => expect(parseTimeHour('22:00:00')).toBe(22))
  it('parses "07:00" to 7',    () => expect(parseTimeHour('07:00')).toBe(7))
  it('returns null for null',  () => expect(parseTimeHour(null)).toBeNull())
  it('returns null for empty', () => expect(parseTimeHour('')).toBeNull())
})
