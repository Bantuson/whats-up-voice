// src/lib/phone.ts
// ISO-02: Every inbound phone number is normalised to E.164 before any DB lookup or upsert.
// WhatsApp sends numbers without the + prefix (e.g. "27821234567").
// Local SA numbers arrive as "0821234567" (10 digits, leading 0).

/**
 * Normalise a phone number to E.164 format.
 * Handles:
 *   "+27821234567" → "+27821234567" (already E.164, returned as-is)
 *   "27821234567"  → "+27821234567" (WhatsApp omits the +)
 *   "0821234567"   → "+27821234567" (local SA format)
 *   "821234567"    → "+821234567"   (bare digits, + prepended)
 */
export function normaliseE164(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('0') && digits.length === 10) {
    // Local SA format: 0821234567 → +27821234567
    return `+27${digits.slice(1)}`
  }
  // Always return +digits — strips dashes, spaces, and other non-digit chars
  return `+${digits}`
}

/**
 * Format a phone number for spoken TTS output.
 * Converts to local format then spaces each digit.
 * +27821234567 → "0 8 2 1 2 3 4 5 6 7"
 * Users hear individual digits, not a cardinal number like "eight hundred million".
 * CONTACT-01 requirement: unknown numbers are spoken digit-by-digit.
 */
export function formatPhoneForSpeech(e164: string): string {
  const local = e164.startsWith('+27') ? '0' + e164.slice(3) : e164.replace(/^\+/, '')
  return local.split('').join(' ')
}
