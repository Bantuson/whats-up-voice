import { useAppStore } from '../store/appStore'
import { HeartbeatRow } from '../components/HeartbeatRow'

export function HeartbeatFeed() {
  const heartbeatLog = useAppStore((s) => s.heartbeatLog)
  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--size-heading)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)', marginBottom: 'var(--space-2xl)' }}>
        Heartbeat Feed
      </h1>
      {heartbeatLog.length === 0 ? (
        <p style={{ fontFamily: 'var(--font-prose)', color: 'var(--color-text-muted)' }}>
          No heartbeat events yet. Waiting for WhatsApp messages.
        </p>
      ) : (
        <table className="data-table">
          <thead><tr><th>Decision</th><th>Time</th><th>From</th><th>Preview</th></tr></thead>
          <tbody>{heartbeatLog.map((e) => <HeartbeatRow key={e.id} event={e} />)}</tbody>
        </table>
      )}
    </div>
  )
}
