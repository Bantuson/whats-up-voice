import { useState } from 'react'
import { useAppStore } from '../store/appStore'

export function Setup() {
  const userId = useAppStore((s) => s.userId)
  const [language, setLanguage] = useState('en')
  const [location, setLocation] = useState('')
  const [quietFrom, setQuietFrom] = useState('22:00')
  const [quietTo, setQuietTo] = useState('07:00')
  const [briefing, setBriefing] = useState(true)
  const [saved, setSaved] = useState(false)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    const token = import.meta.env.VITE_API_TOKEN ?? ''
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ userId, language, location, quietFrom, quietTo, morningBriefing: briefing }),
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--size-heading)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)', marginBottom: 'var(--space-2xl)' }}>
        Setup
      </h1>
      <form onSubmit={handleSave} style={{ maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <div>
          <label className="field-label" htmlFor="language">Language</label>
          <select id="language" className="field-input" value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="en">English</option>
            <option value="af">Afrikaans</option>
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="location">Location (for load shedding)</label>
          <input id="location" type="text" className="field-input" placeholder="Johannesburg" value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
          <div style={{ flex: 1 }}>
            <label className="field-label" htmlFor="quietFrom">Quiet hours from</label>
            <input id="quietFrom" type="time" className="field-input" value={quietFrom} onChange={(e) => setQuietFrom(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="field-label" htmlFor="quietTo">Quiet hours to</label>
            <input id="quietTo" type="time" className="field-input" value={quietTo} onChange={(e) => setQuietTo(e.target.value)} />
          </div>
        </div>
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--size-label)', color: 'var(--color-text-muted)' }}>
          Quiet window: {quietFrom} &ndash; {quietTo}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', minHeight: 'var(--touch-target)' }}>
          <span style={{ fontFamily: 'var(--font-prose)', fontSize: 'var(--size-body)', color: 'var(--color-text)' }}>Morning Briefing</span>
          <button type="button" className="toggle" data-on={String(briefing)} onClick={() => setBriefing(!briefing)} aria-pressed={briefing}>
            <span className="toggle-knob" />
          </button>
        </div>
        <button type="submit" className="btn-primary">{saved ? 'Saved' : 'Save Settings'}</button>
      </form>
    </div>
  )
}
