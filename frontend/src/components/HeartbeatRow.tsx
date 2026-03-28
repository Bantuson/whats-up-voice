// frontend/src/components/HeartbeatRow.tsx
// FE-04: Single row in the heartbeat live feed.
// Colour map: interrupt=#00FF88, batch=#FFAA00, skip=#FF4444, silent=#555555
import type { HeartbeatEvent } from '../store/appStore'

const DECISION_COLOUR: Record<string, string> = {
  interrupt: 'var(--color-interrupt)',
  batch:     'var(--color-batch)',
  skip:      'var(--color-skip)',
  silent:    'var(--color-silent)',
}

export function HeartbeatRow({ event }: { event: HeartbeatEvent }) {
  const colour = DECISION_COLOUR[event.decision] ?? 'var(--color-text-muted)'
  const preview = event.body_preview.length > 48
    ? event.body_preview.slice(0, 48) + '\u2026'
    : event.body_preview
  return (
    <tr style={{ transition: 'transform 150ms ease-out' }}>
      <td>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: colour, display: 'inline-block' }} />
          <span style={{ color: colour, fontFamily: 'var(--font-data)', fontSize: 'var(--size-data)' }}>
            {event.decision}
          </span>
        </span>
      </td>
      <td style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--size-label)', color: 'var(--color-text-muted)' }}>
        {new Date(event.timestamp).toLocaleTimeString()}
      </td>
      <td style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--size-data)', color: 'var(--color-text)' }}>
        {event.from_phone}
      </td>
      <td style={{ fontFamily: 'var(--font-prose)', fontSize: 'var(--size-data)', color: 'var(--color-text-muted)' }}>
        {preview}
      </td>
    </tr>
  )
}
