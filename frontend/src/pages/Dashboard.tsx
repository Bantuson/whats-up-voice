// frontend/src/pages/Dashboard.tsx — Live view, matches root index.html spec
import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { Waveform } from '../components/Waveform'

const STATES: Record<string, { icon: string; tag: string; hint: string; pillText: string; pillClass: string }> = {
  idle:      { icon: '○', tag: 'Idle',             hint: 'Agent is standing by. User activates with a double press.',      pillText: 'Backend online', pillClass: 'pill-green' },
  listening: { icon: '◉', tag: 'Listening',        hint: 'Transcribing voice input in real time.',                         pillText: 'Listening',      pillClass: 'pill-green' },
  composing: { icon: '◈', tag: 'Composing',        hint: 'Resolving contact and writing message draft.',                   pillText: 'Processing',     pillClass: 'pill-amber' },
  awaiting:  { icon: '◇', tag: 'Awaiting approval',hint: 'Draft read aloud. Waiting for user to confirm or cancel.',       pillText: 'Awaiting',       pillClass: 'pill-amber' },
  playing:   { icon: '▷', tag: 'Playing',          hint: 'Agent is reading a message aloud via text-to-speech.',           pillText: 'Speaking',       pillClass: 'pill-blue'  },
}

const PHASES = ['idle', 'listening', 'composing', 'awaiting', 'playing'] as const

function maskPhone(phone: string | null): string {
  if (!phone) return '+27 83 *** 4567'
  // keep first 6 chars and last 4
  if (phone.length < 10) return phone
  return phone.slice(0, 6) + ' *** ' + phone.slice(-4)
}

export function Dashboard() {
  const userId         = useAppStore((s) => s.userId)
  const sessionPhase   = useAppStore((s) => s.sessionPhase)
  const setSessionPhase = useAppStore((s) => s.setSessionPhase)
  const subscribeToSSE = useAppStore((s) => s.subscribeToSSE)
  const [transcript, setTranscript] = useState('')
  const [response, setResponse]     = useState<Record<string, unknown> | null>(null)
  const token = import.meta.env.VITE_API_TOKEN ?? ''

  useEffect(() => {
    if (token) return subscribeToSSE(token)
  }, [token])

  const s = STATES[sessionPhase] ?? STATES.idle

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!transcript.trim()) return
    const res = await fetch('/api/voice/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ userId, transcript, sessionId: userId }),
    })
    const data = await res.json() as Record<string, unknown>
    setResponse(data)
    setTranscript('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minHeight: '100%' }}>

      {/* Topbar */}
      <div className="topbar" style={{ margin: '-32px -32px 0', position: 'sticky', top: -32 }}>
        <div className="topbar-title">Live view</div>
        <div className="topbar-right">
          <div className={`pill ${s.pillClass}`}>{s.pillText}</div>
          <div className="pill pill-gray">{maskPhone(userId)}</div>
        </div>
      </div>

      {/* Cycle buttons */}
      <div className="cycle-bar">
        {PHASES.map((p) => (
          <button
            key={p}
            className={`cycle-btn${sessionPhase === p ? ' sel' : ''}`}
            onClick={() => setSessionPhase(p)}
          >
            {p === 'awaiting' ? 'Awaiting approval' : p}
          </button>
        ))}
      </div>

      {/* Hero orb */}
      <div className="hero-zone">
        <div className={`orb-wrap ${sessionPhase}`}>
          <div className="orb-ring orb-ring-1" />
          <div className="orb-ring orb-ring-2" />
          <div className="orb-ring orb-ring-3" />
          <div className="orb-core">
            <div className="orb-inner">
              <div className="orb-icon">{s.icon}</div>
            </div>
          </div>
        </div>
        <div className="orb-tag">{s.tag}</div>
        <div className="orb-hint">{s.hint}</div>
        <Waveform phase={sessionPhase} />
      </div>

      {/* Transcript zone */}
      <div
        className="transcript-zone"
        style={sessionPhase === 'listening' ? { borderColor: 'rgba(0,232,122,0.35)' } : undefined}
      >
        <div className="zone-label">Voice transcript</div>
        {transcript ? (
          <div className="transcript-text">
            {transcript}
            {sessionPhase === 'listening' && <span className="blink-cursor" />}
          </div>
        ) : (
          <div className="transcript-text empty">Waiting for speech...</div>
        )}
        {/* Dev voice command input */}
        <form onSubmit={handleSend} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input
            className="field-input"
            style={{ flex: 1, height: 34, fontSize: 12 }}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Simulate voice command…"
          />
          <button type="submit" className="cycle-btn sel" style={{ flexShrink: 0 }}>Send</button>
        </form>
        {response && typeof response.spoken === 'string' && (
          <p style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--green)', marginTop: 8 }}>
            {response.spoken}
          </p>
        )}
      </div>

      {/* Draft card — awaiting only */}
      {sessionPhase === 'awaiting' && (
        <div className="draft-card">
          <div className="draft-header">
            <div className="draft-to">To: <strong>Naledi</strong> &nbsp;·&nbsp; +27 83 *** 5591</div>
            <div className="pill pill-amber">Draft</div>
          </div>
          <div className="draft-body">I need condensed milk — can you grab some when you pass the store?</div>
          <div className="draft-actions">
            <button className="btn-send">Send message</button>
            <button className="btn-cancel">Cancel</button>
          </div>
        </div>
      )}

      {/* Playing card — playing only */}
      {sessionPhase === 'playing' && (
        <div className="playing-card">
          <div className="playing-from">Now reading — from Naledi</div>
          <div className="playing-text">"Are you coming home for dinner? I'm thinking of making samp and beans."</div>
          <div className="playing-wf">
            {Array.from({ length: 40 }, (_, i) => (
              <div
                key={i}
                className="pwf-bar"
                style={{
                  height: 8 + Math.abs(Math.sin(i * 0.6) * 14),
                  animation: `wavebar ${0.4 + (i % 4) * 0.1}s ${(i % 6) * 0.05}s ease-in-out infinite alternate`,
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Info grid */}
      <div className="info-grid">
        <div className="info-card">
          <div className="zone-label">Load shedding</div>
          <div className="info-val">Stage 2</div>
          <div className="info-sub">10:00 – 12:00 today</div>
        </div>
        <div className="info-card">
          <div className="zone-label">Weather</div>
          <div className="info-val">18°C</div>
          <div className="info-sub">Partly cloudy, Joburg</div>
        </div>
        <div className="info-card">
          <div className="zone-label">Batched messages</div>
          <div className="info-val">3</div>
          <div className="info-sub">For morning briefing</div>
        </div>
        <div className="info-card">
          <div className="zone-label">Priority contacts</div>
          <div className="info-val">2</div>
          <div className="info-sub">Naledi · Bongani</div>
        </div>
      </div>

      {/* Queue card */}
      <div className="queue-card">
        <div className="zone-label" style={{ marginBottom: 10 }}>Batch queue — digest at 07:00</div>
        <div className="queue-row">
          <div className="queue-name">Naledi</div>
          <div className="queue-preview">Are you coming home for dinner?</div>
          <div className="queue-badge">1 msg</div>
        </div>
        <div className="queue-row">
          <div className="queue-name">Family group</div>
          <div className="queue-preview">Uncle Sipho shared a photo</div>
          <div className="queue-badge">2 msgs</div>
        </div>
      </div>

    </div>
  )
}
