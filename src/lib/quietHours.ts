// src/lib/quietHours.ts
// Pure function — no I/O, no side effects.
// Determines whether the current time falls within quiet hours.
//
// HB-06: Must support overnight ranges where start > end (e.g. 22:00 → 07:00).
// The "current time" is passed in as a parameter so tests can inject any hour.

/**
 * Returns true if the given hour (0–23) falls within quiet hours.
 *
 * @param startHour - quiet hours start (0–23), e.g. 22 for 10 PM
 * @param endHour   - quiet hours end   (0–23), e.g. 7  for 7 AM
 * @param currentHour - hour to test (default: current wall-clock hour in local time)
 *
 * Examples:
 *   isQuietHours(22, 7, 23) → true   (22:xx is in [22, 0, 1, 2, 3, 4, 5, 6])
 *   isQuietHours(22, 7, 6)  → true   (06:xx is in [22, 0, 1, 2, 3, 4, 5, 6])
 *   isQuietHours(22, 7, 8)  → false  (08:xx is outside)
 *   isQuietHours(9, 17, 12) → true   (daytime quiet hours: 09:xx–16:xx)
 *   isQuietHours(9, 17, 18) → false
 */
export function isQuietHours(
  startHour: number,
  endHour: number,
  currentHour: number = new Date().getHours()
): boolean {
  if (startHour === endHour) return false  // misconfigured — treat as no quiet hours

  if (startHour < endHour) {
    // Normal range: both on same day (e.g. 09:00–17:00)
    return currentHour >= startHour && currentHour < endHour
  } else {
    // Overnight range: crosses midnight (e.g. 22:00–07:00)
    return currentHour >= startHour || currentHour < endHour
  }
}

/**
 * Parse a Postgres TIME string ("HH:MM:SS" or "HH:MM") into an hour integer.
 * Returns null if the value is null or malformed.
 */
export function parseTimeHour(timeStr: string | null): number | null {
  if (!timeStr) return null
  const hour = parseInt(timeStr.split(':')[0], 10)
  return isNaN(hour) ? null : hour
}
