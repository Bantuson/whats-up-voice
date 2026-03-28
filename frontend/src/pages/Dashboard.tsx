import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { Waveform } from '../components/Waveform'

export function Dashboard() {
  const userId = useAppStore((s) => s.userId)
  const sessionPhase = useAppStore((s) => s.sessionPhase)
  const subscribeToSSE = useAppStore((s) => s.subscribeToSSE)
  const [transcript, setTranscript] = useState('')
  const [response, setResponse] = useState<Record<string, unknown> | null>(null)
  const token = import.meta.env.VITE_API_TOKEN ?? ''

  useEffect(() => {
    if (token) return subscribeToSSE(token)
  }, [token])

  const isActive = ['listening', 'playing'].includes(sessionPhase)
  const phaseColour = isActive ? 'var(--color-accent)' : 'var(--color-text-muted)'

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!transcript.trim()) return
    const res = await fetch('/api/voice/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ userId, transcript, sessionId: userId }),
    })
    const data = await res.json() as Record<string, unknown>
    setResponse(data)
    setTranscript('')
  }

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--size-heading)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)', marginBottom: 'var(--space-2xl)' }}>
        Dashboard
      </h1>
      <div style={{ display: 'grid', gridTemplateColumns: '60fr 40fr', gap: 'var(--space-xl)' }}>
        {/* Agent state panel */}
        <div style={{ background: 'var(--color-surface)', padding: 'var(--space-xl)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
          <div style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--size-heading)', fontWeight: 'var(--weight-semibold)', color: phaseColour, marginBottom: 'var(--space-md)' }}>
            {sessionPhase}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--space-md)' }}>
            <Waveform phase={sessionPhase} />
          </div>
        </div>
        {/* Voice command simulator */}
        <div style={{ background: 'var(--color-surface)', padding: 'var(--space-xl)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
          <label className="field-label">Simulate Voice Command</label>
          <form onSubmit={handleSend} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', marginTop: 'var(--space-sm)' }}>
            <input className="field-input" value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder="e.g. read my messages" />
            <button type="submit" className="btn-primary">Send Command</button>
          </form>
          {response && (
            <div style={{ marginTop: 'var(--space-md)' }}>
              {typeof response.spoken === 'string' && (
                <p style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--size-data)', color: 'var(--color-accent)', marginBottom: 'var(--space-sm)' }}>
                  {response.spoken}
                </p>
              )}
              <pre style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--size-label)', color: 'var(--color-text-muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {JSON.stringify(response, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
