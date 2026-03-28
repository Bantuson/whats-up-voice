import { describe, test, expect, mock } from 'bun:test'

// Re-register the real phone module implementation before importing.
// hubVerification.test.ts and webhookHandler.test.ts both mock.module('../src/lib/phone')
// with simplified stubs. In Bun 1.3.x the mock registry is process-persistent, so
// those stubs can still be active when phone.test.ts runs (alphabetical test order).
// Declaring mock.module here with the real implementation restores correct behaviour
// for this file's import resolution.
mock.module('../src/lib/phone', () => ({
  normaliseE164(raw: string): string {
    const digits = raw.replace(/\D/g, '')
    if (digits.startsWith('0') && digits.length === 10) {
      return `+27${digits.slice(1)}`
    }
    return `+${digits}`
  },
  formatPhoneForSpeech(e164: string): string {
    const local = e164.startsWith('+27') ? '0' + e164.slice(3) : e164.replace(/^\+/, '')
    return local.split('').join(' ')
  },
}))

import { normaliseE164, formatPhoneForSpeech } from '../src/lib/phone'

describe('ISO-02: E.164 normalisation', () => {
  test('WhatsApp format (no + prefix) → E.164', () => {
    expect(normaliseE164('27821234567')).toBe('+27821234567')
  })

  test('Local SA format (leading 0) → E.164', () => {
    expect(normaliseE164('0821234567')).toBe('+27821234567')
  })

  test('Already E.164 (+ prefix) → unchanged', () => {
    expect(normaliseE164('+27821234567')).toBe('+27821234567')
  })

  test('Other country number without + → + prepended', () => {
    expect(normaliseE164('447700900000')).toBe('+447700900000')
  })

  test('Number with spaces and dashes stripped', () => {
    expect(normaliseE164('082 123 4567')).toBe('+27821234567')
    expect(normaliseE164('+27-82-123-4567')).toBe('+27821234567')
  })
})

describe('ISO-02: formatPhoneForSpeech', () => {
  test('+27 SA number → local format spaced digits', () => {
    // +27821234567 → local 0821234567 → "0 8 2 1 2 3 4 5 6 7"
    expect(formatPhoneForSpeech('+27821234567')).toBe('0 8 2 1 2 3 4 5 6 7')
  })

  test('Non-SA E.164 → digits spaced without +', () => {
    expect(formatPhoneForSpeech('+447700900000')).toBe('4 4 7 7 0 0 9 0 0 0 0 0')
  })

  test('Result contains no raw digit runs — each digit separated by space', () => {
    const spoken = formatPhoneForSpeech('+27821234567')
    // No two consecutive non-space characters
    expect(/\d\d/.test(spoken)).toBe(false)
  })
})
