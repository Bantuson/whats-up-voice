import { useState, useEffect } from 'react'
import { useAppStore } from '../store/appStore'

interface Message {
  id: string
  direction: 'in' | 'out'
  from_phone?: string
  to_phone?: string
  body: string
  created_at: string
}

interface HeartbeatLog {
  id: string
  decision: string
  from_phone: string
  body_preview: string
  created_at: string
}

interface Memory {
  id: string
  summary: string
  embedding_dimensions?: number
  created_at: string
}

export function Log() {
  const userId = useAppStore((s) => s.userId)
  const token = import.meta.env.VITE_API_TOKEN ?? ''
  const [messages, setMessages] = useState<Message[]>([])
  const [heartbeatLogs, setHeartbeatLogs] = useState<HeartbeatLog[]>([])
  const [memories, setMemories] = useState<Memory[]>([])

  const headers = { 'Authorization': `Bearer ${token}` }

  useEffect(() => {
    const load = async () => {
      const [msgRes, hbRes, memRes] = await Promise.all([
        fetch(`/api/messages?userId=${userId}`, { headers }),
        fetch(`/api/heartbeat-log?userId=${userId}`, { headers }),
        fetch(`/api/memories?userId=${userId}`, { headers }),
      ])
      if (msgRes.ok) setMessages(await msgRes.json() as Message[])
      if (hbRes.ok) setHeartbeatLogs(await hbRes.json() as HeartbeatLog[])
      if (memRes.ok) setMemories(await memRes.json() as Memory[])
    }
    void load()
  }, [userId])

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--size-heading)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)', marginBottom: 'var(--space-2xl)' }}>
        Log
      </h1>

      {/* Section 1: Message History */}
      <h2 style={{ fontFamily: 'var(--font-prose)', fontSize: 'var(--size-label)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 'var(--space-md)' }}>
        Message History
      </h2>
      {messages.length === 0 ? (
        <p style={{ fontFamily: 'var(--font-prose)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-2xl)' }}>
          No messages in history.
        </p>
      ) : (
        <table className="data-table" style={{ marginBottom: 'var(--space-2xl)' }}>
          <thead>
            <tr>
              <th>Direction</th>
              <th>From / To</th>
              <th>Time</th>
              <th>Preview</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((msg) => (
              <tr key={msg.id}>
                <td>
                  <span style={{
                    fontFamily: 'var(--font-data)',
                    fontSize: 'var(--size-label)',
                    color: msg.direction === 'in' ? 'var(--color-accent)' : 'var(--color-text-muted)',
                    textTransform: 'uppercase',
                  }}>
                    {msg.direction}
                  </span>
                </td>
                <td>{msg.direction === 'in' ? msg.from_phone : msg.to_phone}</td>
                <td style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--size-label)', color: 'var(--color-text-muted)' }}>
                  {new Date(msg.created_at).toISOString()}
                </td>
                <td style={{ fontFamily: 'var(--font-prose)' }}>
                  {msg.body.length > 48 ? msg.body.slice(0, 48) + '\u2026' : msg.body}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Section 2: Heartbeat Audit */}
      <h2 style={{ fontFamily: 'var(--font-prose)', fontSize: 'var(--size-label)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 'var(--space-md)' }}>
        Heartbeat Audit
      </h2>
      {heartbeatLogs.length === 0 ? (
        <p style={{ fontFamily: 'var(--font-prose)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-2xl)' }}>
          No heartbeat events yet. Waiting for WhatsApp messages.
        </p>
      ) : (
        <table className="data-table" style={{ marginBottom: 'var(--space-2xl)' }}>
          <thead>
            <tr>
              <th>Decision</th>
              <th>From</th>
              <th>Time</th>
              <th>Preview</th>
            </tr>
          </thead>
          <tbody>
            {heartbeatLogs.map((entry) => (
              <tr key={entry.id}>
                <td style={{ fontFamily: 'var(--font-data)' }}>{entry.decision}</td>
                <td>{entry.from_phone}</td>
                <td style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--size-label)', color: 'var(--color-text-muted)' }}>
                  {new Date(entry.created_at).toISOString()}
                </td>
                <td style={{ fontFamily: 'var(--font-prose)' }}>
                  {entry.body_preview.length > 48 ? entry.body_preview.slice(0, 48) + '\u2026' : entry.body_preview}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Section 3: Memory Schema Viewer */}
      <h2 style={{ fontFamily: 'var(--font-prose)', fontSize: 'var(--size-label)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 'var(--space-md)' }}>
        Memory Schema Viewer
      </h2>
      {memories.length === 0 ? (
        <p style={{ fontFamily: 'var(--font-prose)', color: 'var(--color-text-muted)' }}>
          No memories stored yet. Memories are created after completed sessions.
        </p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Created</th>
              <th>Summary</th>
              <th>Embedding Dimensions</th>
            </tr>
          </thead>
          <tbody>
            {memories.map((mem) => (
              <tr key={mem.id}>
                <td style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--size-label)', color: 'var(--color-text-muted)' }}>
                  {new Date(mem.created_at).toISOString()}
                </td>
                <td style={{ fontFamily: 'var(--font-prose)' }}>
                  {mem.summary.length > 48 ? mem.summary.slice(0, 48) + '\u2026' : mem.summary}
                </td>
                <td style={{ fontFamily: 'var(--font-data)' }}>1536</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
