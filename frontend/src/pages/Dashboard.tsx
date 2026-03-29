// frontend/src/pages/Dashboard.tsx — Live view, matches root index.html spec
import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { Waveform } from '../components/Waveform'
import type { ChatEntry } from '../store/appStore'

const STATES: Record<string, { icon: string; tag: string; hint: string; pillText: string; pillClass: string }> = {
  idle:      { icon: '○', tag: 'Idle',             hint: 'Agent is standing by. User activates with a double press.',      pillText: 'Backend online', pillClass: 'pill-green' },
  listening: { icon: '◉', tag: 'Listening',        hint: 'Transcribing voice input in real time.',                         pillText: 'Listening',      pillClass: 'pill-green' },
  composing: { icon: '◈', tag: 'Composing',        hint: 'Resolving contact and writing message draft.',                   pillText: 'Processing',     pillClass: 'pill-amber' },
  awaiting:  { icon: '◇', tag: 'Awaiting approval',hint: 'Draft read aloud. Waiting for user to confirm or cancel.',       pillText: 'Awaiting',       pillClass: 'pill-amber' },
  playing:   { icon: '▷', tag: 'Playing',          hint: 'Agent is reading a message aloud via text-to-speech.',           pillText: 'Speaking',       pillClass: 'pill-blue'  },
}



interface DashboardData {
  weather: { temp: number | null; description: string | null }
  loadShedding: { stage: string | null; time: string | null }
  batchedCount: number
  priorityContacts: { count: number; names: string[] }
  queue: Array<{ name: string; preview: string; count: number }>
}

export function Dashboard() {
  const userId          = useAppStore((s) => s.userId)
  const sessionPhase    = useAppStore((s) => s.sessionPhase)
  const composingHint   = useAppStore((s) => s.composingHint)
  const setSessionPhase = useAppStore((s) => s.setSessionPhase)
  const subscribeToSSE  = useAppStore((s) => s.subscribeToSSE)
  const chatLog         = useAppStore((s) => s.chatLog)
  const addChatEntry    = useAppStore((s) => s.addChatEntry)
  const [isRecording, setIsRecording] = useState(false)
  const [micError, setMicError]       = useState('')
  const [dash, setDash] = useState<DashboardData | null>(null)
  const chatEndRef = useRef<HTMLDivElement | null>(null)
  const mediaRecorderRef  = useRef<MediaRecorder | null>(null)
  const micChunksRef      = useRef<Blob[]>([])
  const wsAudioChunks     = useRef<ArrayBuffer[]>([])
  const setPhaseRef = useRef(setSessionPhase)
  const token = import.meta.env.VITE_API_TOKEN ?? ''

  // SSE subscription for live phase + heartbeat updates
  useEffect(() => {
    if (token) return subscribeToSSE(token)
  }, [token])

  // Fetch live dashboard data
  useEffect(() => {
    if (!userId || !token) return
    const load = () =>
      fetch(`/api/dashboard?userId=${userId}`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.ok ? r.json() as Promise<DashboardData> : Promise.reject())
        .then(setDash)
        .catch(() => {})
    void load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [userId, token])

  // WebSocket connection — receives TTS audio frames directly from backend (bypasses Vite proxy)
  useEffect(() => {
    if (!userId) return
    const wsBase = (import.meta.env.VITE_WS_URL as string | undefined)
      ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`
    const ws = new WebSocket(`${wsBase}/ws/session/${userId}`)
    ws.binaryType = 'arraybuffer'

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        wsAudioChunks.current.push(event.data)
      } else if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data) as { type: string }
          if (msg.type === 'audio_start') {
            wsAudioChunks.current = []
            setPhaseRef.current('playing')
          } else if (msg.type === 'audio_end' && wsAudioChunks.current.length > 0) {
            const blob = new Blob(wsAudioChunks.current, { type: 'audio/mpeg' })
            const url = URL.createObjectURL(blob)
            const audio = new Audio(url)
            audio.play().catch(() => {})
            audio.onended = () => { URL.revokeObjectURL(url); setPhaseRef.current('idle') }
            wsAudioChunks.current = []
          }
        } catch { /* non-JSON ping frames */ }
      }
    }

    return () => { ws.close() }
  }, [userId])

  // Auto-scroll chat log to latest entry
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatLog])

  const s = STATES[sessionPhase] ?? STATES.idle
  const hint = (sessionPhase === 'composing' && composingHint) ? composingHint : s.hint

  const startRecording = async () => {
    setMicError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      micChunksRef.current = []
      const recorder = new MediaRecorder(stream)
      recorder.ondataavailable = (e) => { if (e.data.size > 0) micChunksRef.current.push(e.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        setSessionPhase('composing')
        const blob = new Blob(micChunksRef.current, { type: 'audio/ogg; codecs=opus' })
        const form = new FormData()
        form.append('userId', userId ?? '')
        form.append('audioBlob', blob, 'audio.ogg')
        try {
          const res = await fetch('/api/voice/command', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: form,
          })
          const data = await res.json() as { spoken?: string; requiresConfirmation?: boolean; error?: string }
          if (!res.ok || !data.spoken) {
            const errMsg = data.error ?? `Voice command failed (${res.status})`
            addChatEntry({ role: 'agent', text: `[Error] ${errMsg}` })
            setSessionPhase('idle')
            return
          }
          addChatEntry({ role: 'agent', text: data.spoken })

          // Fetch TTS for the spoken response — single audio path (no WebSocket duplication)
          const afterPlay = data.requiresConfirmation ? 'awaiting' : 'idle'
          setSessionPhase('playing')
          const ttsRes = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ text: data.spoken, userId }),
          })
          if (ttsRes.ok) {
            const audioBlob = await ttsRes.blob()
            const url = URL.createObjectURL(audioBlob)
            const audio = new Audio(url)
            audio.play().catch((e: unknown) => {
              console.error('[Audio] play() failed:', e)
              addChatEntry({ role: 'agent', text: `[Audio error] ${e instanceof Error ? e.message : 'Playback failed'}` })
            })
            audio.onended = () => { URL.revokeObjectURL(url); setPhaseRef.current(afterPlay) }
          } else {
            const errData = await ttsRes.json().catch(() => ({ error: `HTTP ${ttsRes.status}` })) as { error?: string }
            const errMsg = errData.error ?? `TTS failed (${ttsRes.status})`
            addChatEntry({ role: 'agent', text: `[Audio error] ${errMsg}` })
            setSessionPhase(afterPlay)
          }
        } catch (e: unknown) {
          const errMsg = e instanceof Error ? e.message : 'Network error'
          addChatEntry({ role: 'agent', text: `[Error] ${errMsg}` })
          setSessionPhase('idle')
        }
      }
      recorder.start()
      mediaRecorderRef.current = recorder
      setIsRecording(true)
      setSessionPhase('listening')
    } catch {
      setMicError('Microphone access denied.')
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    mediaRecorderRef.current = null
    setIsRecording(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minHeight: '100%' }}>

      {/* Topbar */}
      <div className="topbar" style={{ margin: '-32px -32px 0', position: 'sticky', top: -32 }}>
        <div className="topbar-title">Live view</div>
        <div className="topbar-right">
          <div className={`pill ${s.pillClass}`}>{s.pillText}</div>
        </div>
      </div>

      {/* Mic button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="button"
          onClick={isRecording ? stopRecording : startRecording}
          title={isRecording ? 'Stop' : 'Tap to speak'}
          style={{
            width: 40, height: 40, borderRadius: '50%', border: 'none', cursor: 'pointer',
            background: isRecording ? '#ff4444' : 'var(--color-accent, #00E87A)',
            color: '#000', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: isRecording ? '0 0 0 5px rgba(255,68,68,0.25)' : 'none',
            transition: 'background 0.15s, box-shadow 0.15s',
            flexShrink: 0,
          }}
        >
          {isRecording ? '■' : '🎙'}
        </button>
        <span style={{ fontFamily: 'var(--font-data, monospace)', fontSize: 12, color: 'var(--color-text-muted)' }}>
          {isRecording ? 'Recording — tap to stop' : 'Tap to speak'}
        </span>
        {micError && <span style={{ fontSize: 11, color: '#ff4444' }}>{micError}</span>}
      </div>
      {/* Chat log — persists across navigation */}
      {chatLog.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto', paddingRight: 4 }}>
          {chatLog.map((entry: ChatEntry) => (
            <div key={entry.ts} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{
                flexShrink: 0,
                fontFamily: 'var(--font-data)',
                fontSize: 9,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                paddingTop: 3,
                color: entry.role === 'user' ? 'var(--color-text-muted)' : 'var(--color-accent, #00E87A)',
                minWidth: 40,
              }}>
                {entry.role === 'user' ? 'You' : 'Agent'}
              </div>
              <div style={{
                fontFamily: 'var(--font-prose)',
                fontSize: 'var(--size-body)',
                color: entry.role === 'user' ? 'var(--color-text-muted)' : 'var(--color-text)',
                lineHeight: 1.5,
              }}>
                {entry.text}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
      )}

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
        <div className="orb-hint">{hint}</div>
        <Waveform phase={sessionPhase} />
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


      {/* Info grid */}
      <div className="info-grid">
        <div className="info-card">
          <div className="zone-label">Load shedding</div>
          <div className="info-val">{dash?.loadShedding.stage ?? '—'}</div>
          <div className="info-sub">{dash?.loadShedding.time ?? (dash ? 'None scheduled' : '…')}</div>
        </div>
        <div className="info-card">
          <div className="zone-label">Weather</div>
          <div className="info-val">{dash?.weather.temp != null ? `${dash.weather.temp}°C` : '—'}</div>
          <div className="info-sub">{dash?.weather.description ?? (dash ? 'Unavailable' : '…')}</div>
        </div>
        <div className="info-card">
          <div className="zone-label">Batched messages</div>
          <div className="info-val">{dash?.batchedCount ?? '—'}</div>
          <div className="info-sub">For morning briefing</div>
        </div>
        <div className="info-card">
          <div className="zone-label">Priority contacts</div>
          <div className="info-val">{dash?.priorityContacts.count ?? '—'}</div>
          <div className="info-sub">{dash?.priorityContacts.names.join(' · ') || (dash ? 'None set' : '…')}</div>
        </div>
      </div>

      {/* Queue card */}
      <div className="queue-card">
        <div className="zone-label" style={{ marginBottom: 10 }}>Batch queue — digest at 07:00</div>
        {dash?.queue.length === 0 && (
          <div style={{ fontFamily: 'var(--font-prose)', fontSize: 12, color: 'var(--color-text-muted)' }}>No messages queued.</div>
        )}
        {(dash?.queue ?? []).map((row) => (
          <div className="queue-row" key={row.name}>
            <div className="queue-name">{row.name}</div>
            <div className="queue-preview">{row.preview}</div>
            <div className="queue-badge">{row.count} {row.count === 1 ? 'msg' : 'msgs'}</div>
          </div>
        ))}
      </div>

    </div>
  )
}
