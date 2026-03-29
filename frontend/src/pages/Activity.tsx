import { useEffect, useMemo, useState } from 'react'
import { useAppStore, type HeartbeatEvent } from '../store/appStore'
import { relativeTime } from '../utils/time'

// ── Types ────────────────────────────────────────────────────────────────────

interface RawMessage {
  id: string
  direction: 'in' | 'out'
  from_phone?: string
  to_phone?: string
  body: string
  created_at: string
}

interface RawHeartbeat {
  id: string
  decision: 'interrupt' | 'batch' | 'skip' | 'silent'
  from_phone: string
  body_preview: string
  created_at: string
}

type ActivityEvent =
  | { kind: 'heartbeat'; id: string; decision: string; phone: string; body: string; ts: string }
  | { kind: 'message';   id: string; direction: 'in' | 'out'; phone: string; body: string; ts: string }

// ── Normalise helpers ─────────────────────────────────────────────────────────

function fromLiveHB(e: HeartbeatEvent): ActivityEvent {
  return { kind: 'heartbeat', id: e.id, decision: e.decision, phone: e.from_phone, body: e.body_preview, ts: e.timestamp }
}

function fromRawHB(e: RawHeartbeat): ActivityEvent {
  return { kind: 'heartbeat', id: e.id, decision: e.decision, phone: e.from_phone, body: e.body_preview, ts: e.created_at }
}

function fromRawMsg(m: RawMessage): ActivityEvent {
  return {
    kind: 'message',
    id: m.id,
    direction: m.direction,
    phone: (m.direction === 'in' ? m.from_phone : m.to_phone) ?? '—',
    body: m.body,
    ts: m.created_at,
  }
}

// ── Badge config ──────────────────────────────────────────────────────────────

const BADGE: Record<string, { label: string; cls: string }> = {
  interrupt: { label: 'INTERRUPT', cls: 'badge-interrupt' },
  batch:     { label: 'BATCH',     cls: 'badge-batch' },
  skip:      { label: 'SKIP',      cls: 'badge-skip' },
  silent:    { label: 'SILENT',    cls: 'badge-silent' },
  'msg-in':  { label: 'MSG IN',    cls: 'badge-msg-in' },
  'msg-out': { label: 'SENT',      cls: 'badge-sent' },
}

function badgeKey(e: ActivityEvent): string {
  if (e.kind === 'heartbeat') return e.decision
  return e.direction === 'in' ? 'msg-in' : 'msg-out'
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Activity() {
  const heartbeatLog = useAppStore((s) => s.heartbeatLog)
  const userId       = useAppStore((s) => s.userId)
  const token        = import.meta.env.VITE_API_TOKEN ?? ''

  const [messages,     setMessages]     = useState<RawMessage[]>([])
  const [historicalHB, setHistoricalHB] = useState<RawHeartbeat[]>([])

  useEffect(() => {
    if (!userId) return
    const headers = { Authorization: `Bearer ${token}` }
    void Promise.all([
      fetch(`/api/messages?userId=${userId}`,       { headers }).then((r) => r.ok ? r.json() as Promise<RawMessage[]>   : []),
      fetch(`/api/heartbeat-log?userId=${userId}`,  { headers }).then((r) => r.ok ? r.json() as Promise<RawHeartbeat[]> : []),
    ]).then(([msgs, hbs]) => {
      setMessages(msgs)
      setHistoricalHB(hbs)
    })
  }, [userId, token])

  // IDs already in the live SSE store — avoid duplicating them from the API fetch
  const liveIds = useMemo(() => new Set(heartbeatLog.map((e) => e.id)), [heartbeatLog])

  const events: ActivityEvent[] = useMemo(() => {
    const live = heartbeatLog.map(fromLiveHB)
    const hist = historicalHB.filter((h) => !liveIds.has(h.id)).map(fromRawHB)
    const msgs = messages.map(fromRawMsg)
    return [...live, ...hist, ...msgs].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
  }, [heartbeatLog, historicalHB, messages, liveIds])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>

      {/* Topbar */}
      <div className="topbar" style={{ margin: '-32px -32px 0', position: 'sticky', top: -32 }}>
        <div className="topbar-title">Activity</div>
        <div className="topbar-right">
          <div className="pill pill-green">{heartbeatLog.length} live</div>
        </div>
      </div>

      {events.length === 0 ? (
        <p style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--mid)', marginTop: 28 }}>
          No activity yet. Waiting for WhatsApp messages.
        </p>
      ) : (
        <div className="activity-stream">
          {events.map((e) => {
            const badge = BADGE[badgeKey(e)] ?? { label: badgeKey(e).toUpperCase(), cls: 'badge-silent' }
            const preview = e.body.length > 60 ? e.body.slice(0, 60) + '\u2026' : e.body
            return (
              <div key={e.id} className="activity-row">
                <span className={`event-badge ${badge.cls}`}>{badge.label}</span>
                <div className="event-detail">
                  <span className="event-phone">{e.phone}</span>
                  <span className="event-body">{preview}</span>
                </div>
                <span className="event-time" title={new Date(e.ts).toISOString()}>
                  {relativeTime(e.ts)}
                </span>
              </div>
            )
          })}
        </div>
      )}

    </div>
  )
}
