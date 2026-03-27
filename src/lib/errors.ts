// src/lib/errors.ts
// TTS-ready spoken error messages for all unhappy paths in the voice flow.
// Using a shared utility ensures consistent phrasing across all error paths.
// Every place that would speak an error to the user calls spokenError().

/**
 * Returns a TTS-safe spoken error string.
 * @param context - human-readable description of what failed, e.g. "sending your message"
 * @returns spoken string like "Sorry, I had a problem with sending your message. Please try again."
 */
export function spokenError(context: string): string {
  return `Sorry, I had a problem with ${context}. Please try again.`
}
