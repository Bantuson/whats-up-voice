import { useEffect, useState, useRef } from 'react'
import { useAppStore } from '../store/appStore'

interface Podcast {
  id: string
  topic: string
  script: string
  created_at: string
}

interface Segment {
  speaker: 'THABO' | 'NALEDI'
  text: string
}

function parseSegments(script: string): Segment[] {
  const segments: Segment[] = []
  const lines = script.split('\n')
  let current: Segment | null = null
  for (const line of lines) {
    const tMatch = line.match(/^\[THABO\]:\s*(.+)/)
    const nMatch = line.match(/^\[NALEDI\]:\s*(.+)/)
    if (tMatch) { if (current) segments.push(current); current = { speaker: 'THABO', text: tMatch[1].trim() } }
    else if (nMatch) { if (current) segments.push(current); current = { speaker: 'NALEDI', text: nMatch[1].trim() } }
    else if (current && line.trim()) current.text += ' ' + line.trim()
  }
  if (current) segments.push(current)
  return segments
}

export function Podcasts() {
  const userId = useAppStore((s) => s.userId)
  const token = import.meta.env.VITE_API_TOKEN ?? ''
  const [podcasts, setPodcasts] = useState<Podcast[]>([])
  const [fetchError, setFetchError] = useState('')
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    if (!userId || !token) return
    fetch(`/api/podcasts?userId=${userId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        if (!r.ok) { setFetchError(`Server error ${r.status} — run supabase/migrations/004_podcasts.sql`); return }
        const d = await r.json() as { podcasts: Podcast[] }
        setPodcasts(d.podcasts)
      })
      .catch(() => setFetchError('Could not load podcasts. Is the backend running?'))
  }, [userId, token])

  const play = async (podcast: Podcast) => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
      if (playingId === podcast.id) { setPlayingId(null); return }
    }
    setLoadingId(podcast.id)
    try {
      const res = await fetch(`/api/podcasts/${podcast.id}/audio`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio
      setPlayingId(podcast.id)
      audio.play().catch(() => {})
      audio.onended = () => { URL.revokeObjectURL(url); setPlayingId(null); audioRef.current = null }
    } finally {
      setLoadingId(null)
    }
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })

  const wordCount = (script: string) => script.replace(/\[(THABO|NALEDI)\]:\s*/g, '').split(' ').length

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--size-heading)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)', marginBottom: 'var(--space-2xl)' }}>
        Podcasts
      </h1>

      {fetchError && (
        <p style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: '#ff4444', marginBottom: 'var(--space-lg)' }}>
          {fetchError}
        </p>
      )}
      {!fetchError && podcasts.length === 0 ? (
        <p style={{ fontFamily: 'var(--font-prose)', color: 'var(--color-text-muted)' }}>
          No podcasts yet. Say "tell me about [topic]" to generate one.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          {podcasts.map((p) => {
            const segments = parseSegments(p.script)
            const isExpanded = expandedId === p.id
            return (
              <div key={p.id} className="info-card" style={{ padding: 'var(--space-md) var(--space-lg)' }}>
                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                  <button
                    type="button"
                    onClick={() => void play(p)}
                    title={playingId === p.id ? 'Stop' : 'Play'}
                    style={{
                      width: 36, height: 36, borderRadius: '50%', border: 'none', cursor: 'pointer', flexShrink: 0,
                      background: playingId === p.id ? '#ff4444' : 'var(--color-accent, #00E87A)',
                      color: '#000', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      opacity: loadingId === p.id ? 0.5 : 1,
                    }}
                    disabled={loadingId !== null && loadingId !== p.id}
                  >
                    {loadingId === p.id ? '…' : playingId === p.id ? '■' : '▷'}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--size-body)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)', textTransform: 'capitalize' }}>
                      {p.topic}
                    </div>
                    <div style={{ fontFamily: 'var(--font-prose)', fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                      {fmt(p.created_at)} · {Math.round(wordCount(p.script) / 140)} min · {segments.length} exchanges
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {playingId === p.id && (
                      <div className="pill pill-blue">Playing</div>
                    )}
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : p.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 12, padding: '4px 8px' }}
                    >
                      {isExpanded ? 'Hide' : 'Script'}
                    </button>
                  </div>
                </div>

                {/* Dialogue transcript */}
                {isExpanded && (
                  <div style={{ marginTop: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                    {segments.length > 0 ? segments.map((seg, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <div style={{
                          flexShrink: 0, width: 52, fontFamily: 'var(--font-data)', fontSize: 10,
                          fontWeight: 'var(--weight-semibold)', paddingTop: 2,
                          color: seg.speaker === 'THABO' ? 'var(--color-accent, #00E87A)' : '#A78BFA',
                          textTransform: 'uppercase', letterSpacing: '0.05em',
                        }}>
                          {seg.speaker}
                        </div>
                        <div style={{ fontFamily: 'var(--font-prose)', fontSize: 12, color: 'var(--color-text)', lineHeight: 1.5 }}>
                          {seg.text}
                        </div>
                      </div>
                    )) : (
                      <div style={{ fontFamily: 'var(--font-prose)', fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'pre-wrap' }}>
                        {p.script}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
