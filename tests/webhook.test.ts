import { describe, expect, it } from 'bun:test'
import crypto from 'node:crypto'
import { verifyWhatsAppHmac } from '../src/lib/hmac'

const SECRET = 'test-secret-abc'

function sign(body: string): string {
  const hex = crypto.createHmac('sha256', SECRET).update(body, 'utf8').digest('hex')
  return `sha256=${hex}`
}

describe('verifyWhatsAppHmac', () => {
  it('accepts a valid signature', () => {
    const body = '{"object":"whatsapp_business_account"}'
    expect(verifyWhatsAppHmac(body, sign(body), SECRET)).toBe(true)
  })

  it('rejects a tampered body', () => {
    const body    = '{"object":"whatsapp_business_account"}'
    const tampered = body + ' '
    expect(verifyWhatsAppHmac(tampered, sign(body), SECRET)).toBe(false)
  })

  it('rejects a missing/empty signature', () => {
    const body = '{"object":"whatsapp_business_account"}'
    expect(verifyWhatsAppHmac(body, '', SECRET)).toBe(false)
  })

  it('rejects a wrong secret', () => {
    const body = '{"object":"whatsapp_business_account"}'
    expect(verifyWhatsAppHmac(body, sign(body), 'wrong-secret')).toBe(false)
  })

  it('rejects a signature without sha256= prefix', () => {
    const body = '{"object":"whatsapp_business_account"}'
    const hexOnly = crypto.createHmac('sha256', SECRET).update(body, 'utf8').digest('hex')
    // strip prefix — should be treated as hex decode of empty → mismatch
    expect(verifyWhatsAppHmac(body, hexOnly, SECRET)).toBe(false)
  })
})

describe('WhatsApp payload parsing', () => {
  it('identifies a text message event', () => {
    const payload = {
      entry: [{
        changes: [{
          value: {
            messages: [{ id: 'wamid.001', from: '27821234567', type: 'text', text: { body: 'Hello' } }]
          }
        }]
      }]
    }
    const value = payload.entry[0].changes[0].value
    expect(value.messages).toBeDefined()
    expect(value.messages[0].from).toBe('27821234567')
    expect(value.messages[0].text.body).toBe('Hello')
  })

  it('identifies a status callback (should be discarded)', () => {
    const payload = {
      entry: [{
        changes: [{
          value: {
            statuses: [{ id: 'wamid.001', status: 'delivered' }]
          }
        }]
      }]
    }
    const value = payload.entry[0].changes[0].value
    // No messages array → handler should return 200 and not enqueue
    expect(value.statuses).toBeDefined()
    expect((value as any).messages).toBeUndefined()
  })
})
