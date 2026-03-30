// src/lib/hmac.ts
import crypto from 'node:crypto'

/**
 * Verify a Twilio webhook request signature.
 *
 * Algorithm:
 *   1. Sort POST params alphabetically by key (decoded values)
 *   2. Concatenate as key₁value₁key₂value₂… (no separator)
 *   3. Prepend the full webhook URL: url + concatenatedParams
 *   4. HMAC-SHA1(data, authToken) → base64
 *   5. Constant-time compare with X-Twilio-Signature header value
 *
 * @param url       - Full webhook URL including protocol and host (e.g. https://…/webhook/whatsapp)
 * @param params    - Decoded POST parameter key→value pairs (from URLSearchParams)
 * @param signature - Value of X-Twilio-Signature header (base64 string)
 * @param authToken - TWILIO_AUTH_TOKEN
 * @returns true if signature is valid, false otherwise
 */
export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string,
  authToken: string
): boolean {
  if (!signature) return false

  // Step 1 + 2: sort keys, concatenate key+value pairs
  const sortedKeys = Object.keys(params).sort()
  const paramStr = sortedKeys.map(k => `${k}${params[k]}`).join('')

  // Step 3: prepend URL
  const data = url + paramStr

  // Step 4: HMAC-SHA1, base64-encode (Twilio uses SHA1, not SHA256)
  const expected = crypto
    .createHmac('sha1', authToken)
    .update(data, 'utf8')
    .digest('base64')

  // Step 5: constant-time comparison (buffer lengths must match)
  try {
    const expectedBuf  = Buffer.from(expected, 'base64')
    const receivedBuf  = Buffer.from(signature, 'base64')
    if (expectedBuf.length !== receivedBuf.length) return false
    return crypto.timingSafeEqual(expectedBuf, receivedBuf)
  } catch {
    return false
  }
}
