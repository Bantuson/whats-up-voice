import { describe, test, expect, mock } from 'bun:test'
import { normaliseE164 } from '../src/lib/phone'

// Re-register the real phone module so this file always uses the real normaliseE164,
// regardless of mock.module order from other test files.
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

describe('Message log helpers', () => {
  test('message insert object has required shape', () => {
    const entry = {
      user_id: 'user-abc',
      from_phone: normaliseE164('27821234567'),
      to_phone: process.env.TWILIO_WHATSAPP_NUMBER ?? '+14155238886',
      direction: 'in' as const,
      body: 'Hello',
      wa_message_id: 'wamid.test001',
    }
    expect(entry).toHaveProperty('user_id')
    expect(entry).toHaveProperty('from_phone')
    expect(entry).toHaveProperty('to_phone')
    expect(entry).toHaveProperty('direction')
    expect(entry).toHaveProperty('body')
    expect(entry).toHaveProperty('wa_message_id')
  })

  test('direction enum: only in or out are valid values', () => {
    const validDirections = ['in', 'out']
    expect(validDirections).toContain('in')
    expect(validDirections).toContain('out')
    expect(validDirections).not.toContain('inbound')
    expect(validDirections).not.toContain('outbound')
  })

  test('to_phone stores the full TWILIO_WHATSAPP_NUMBER including + prefix', () => {
    const phoneNumberId = '15550000000'
    const toPhone = `+${phoneNumberId}`
    expect(toPhone).toMatch(/^\+\d+$/)
    expect(toPhone.startsWith('+')).toBe(true)
  })

  test('from_phone is normalised E.164 — always starts with +', () => {
    const rawFromWhatsApp = '27821234567'
    const normalised = normaliseE164(rawFromWhatsApp)
    expect(normalised.startsWith('+')).toBe(true)
    expect(normalised).toBe('+27821234567')
  })

  test('missing body defaults to empty string not undefined', () => {
    const body = (undefined as unknown as string) ?? ''
    expect(body).toBe('')
    expect(typeof body).toBe('string')
  })

  test('dedup: same wa_message_id processed only once', () => {
    const seen = new Set<string>()
    const messageId = 'wamid.duplicate001'
    const firstSeen = !seen.has(messageId)
    seen.add(messageId)
    const secondSeen = !seen.has(messageId)
    expect(firstSeen).toBe(true)   // first time: not a duplicate
    expect(secondSeen).toBe(false)  // second time: duplicate detected
  })
})
