// src/lib/hmac.ts
import crypto from 'node:crypto'

/**
 * Verify a WhatsApp HMAC-SHA256 signature.
 * @param rawBody   - raw request body string (as captured by middleware)
 * @param signature - value of x-hub-signature-256 header (includes "sha256=" prefix)
 * @param secret    - WHATSAPP_APP_SECRET
 * @returns true if signature is valid, false otherwise
 */
export function verifyWhatsAppHmac(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  // Require the "sha256=" prefix — reject bare hex strings
  if (!signature.startsWith('sha256=')) return false
  const hex = signature.slice('sha256='.length)
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest()
  const received = Buffer.from(hex, 'hex')
  if (received.length !== expected.length) return false
  return crypto.timingSafeEqual(expected, received)
}
