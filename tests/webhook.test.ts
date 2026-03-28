import { describe, expect, it } from 'bun:test'
import crypto from 'node:crypto'
import { verifyTwilioSignature } from '../src/lib/hmac'

const AUTH_TOKEN = 'test-twilio-auth-token'
const WEBHOOK_URL = 'https://example.com/webhook/whatsapp'

/**
 * Compute a valid Twilio signature for a given URL and params object.
 * Mirrors the algorithm in verifyTwilioSignature exactly.
 */
function sign(url: string, params: Record<string, string>): string {
  const sortedKeys = Object.keys(params).sort()
  const paramStr = sortedKeys.map(k => `${k}${params[k]}`).join('')
  const data = url + paramStr
  return crypto.createHmac('sha256', AUTH_TOKEN).update(data, 'utf8').digest('base64')
}

const VALID_PARAMS = {
  From:       'whatsapp:+27821234567',
  To:         'whatsapp:+14155238886',
  Body:       'Hello',
  MessageSid: 'SMtest0000000000000000000000000000',
  NumMedia:   '0',
}

describe('verifyTwilioSignature', () => {
  it('accepts a valid signature', () => {
    const sig = sign(WEBHOOK_URL, VALID_PARAMS)
    expect(verifyTwilioSignature(WEBHOOK_URL, VALID_PARAMS, sig, AUTH_TOKEN)).toBe(true)
  })

  it('rejects a tampered param value', () => {
    const sig = sign(WEBHOOK_URL, VALID_PARAMS)
    const tampered = { ...VALID_PARAMS, Body: 'Tampered' }
    expect(verifyTwilioSignature(WEBHOOK_URL, tampered, sig, AUTH_TOKEN)).toBe(false)
  })

  it('rejects a missing/empty signature', () => {
    expect(verifyTwilioSignature(WEBHOOK_URL, VALID_PARAMS, '', AUTH_TOKEN)).toBe(false)
  })

  it('rejects a wrong auth token', () => {
    const sig = sign(WEBHOOK_URL, VALID_PARAMS)
    expect(verifyTwilioSignature(WEBHOOK_URL, VALID_PARAMS, sig, 'wrong-token')).toBe(false)
  })

  it('rejects when URL does not match (production vs staging)', () => {
    const sig = sign(WEBHOOK_URL, VALID_PARAMS)
    const differentUrl = 'https://staging.example.com/webhook/whatsapp'
    expect(verifyTwilioSignature(differentUrl, VALID_PARAMS, sig, AUTH_TOKEN)).toBe(false)
  })

  it('accepts an empty params object (URL-only signature)', () => {
    const emptyParams: Record<string, string> = {}
    const sig = sign(WEBHOOK_URL, emptyParams)
    expect(verifyTwilioSignature(WEBHOOK_URL, emptyParams, sig, AUTH_TOKEN)).toBe(true)
  })

  it('is insensitive to param insertion order — sorts keys', () => {
    const reordered: Record<string, string> = {
      NumMedia:   VALID_PARAMS.NumMedia,
      From:       VALID_PARAMS.From,
      MessageSid: VALID_PARAMS.MessageSid,
      Body:       VALID_PARAMS.Body,
      To:         VALID_PARAMS.To,
    }
    const sig = sign(WEBHOOK_URL, VALID_PARAMS)  // signed with sorted order
    expect(verifyTwilioSignature(WEBHOOK_URL, reordered, sig, AUTH_TOKEN)).toBe(true)
  })
})

describe('Twilio payload field extraction', () => {
  it('strips whatsapp: prefix from From field', () => {
    const from = 'whatsapp:+27821234567'
    const rawPhone = from.replace(/^whatsapp:/, '')
    expect(rawPhone).toBe('+27821234567')
  })

  it('identifies a voice note by NumMedia > 0', () => {
    const params = new URLSearchParams(
      'From=whatsapp%3A%2B27821234567&Body=&MessageSid=SM001&NumMedia=1&MediaContentType0=audio%2Fogg'
    )
    const numMedia = parseInt(params.get('NumMedia') ?? '0', 10)
    expect(numMedia).toBe(1)
    expect(params.get('MediaContentType0')).toBe('audio/ogg')
  })

  it('identifies a text message by NumMedia = 0', () => {
    const params = new URLSearchParams(
      'From=whatsapp%3A%2B27821234567&Body=Hello&MessageSid=SM001&NumMedia=0'
    )
    const numMedia = parseInt(params.get('NumMedia') ?? '0', 10)
    expect(numMedia).toBe(0)
  })
})
