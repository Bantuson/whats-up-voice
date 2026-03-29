// frontend/src/pages/Configure.tsx
// Caregiver configuration space — replaces Contacts, Setup, Routines, Feed, Log as separate pages.
// One scrollable view with four sections: VI User · Contacts · Schedule · Activity
// The caregiver sets this up once, rarely returns. Everything they need is here.
import { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../store/appStore'
import type { HeartbeatEvent } from '../store/appStore'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Contact {
  id: string
  name: string
  phone: string
  is_priority: boolean
}

interface Routine {
  id: string
  label: string
  cron: string
  type: string
  enabled: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const apiToken = () => (import.meta.env.VITE_API_TOKEN as string | undefined) ?? ''
const authHdr  = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken()}` })

function humanCron(cron: string): string {
  if (cron === '0 7 * * 1-5') return 'Weekdays at 7:00'
  if (cron === '0 18 * * *')  return 'Daily at 18:00'
  return cron
}

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function parseBulkInput(raw: string): { name: string; phone: string }[] {
  const trimmed = raw.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown[]
      return parsed
        .filter((x): x is { name: string; phone: string } => typeof x === 'object' && x !== null && 'name' in x && 'phone' in x)
        .map((x) => ({ name: String(x.name).trim(), phone: String(x.phone).trim() }))
        .filter((c) => c.name && c.phone)
    } catch { /* fall through to CSV */ }
  }
  return trimmed.split('\n').map((line) => {
    const parts = line.split(',')
    if (parts.length < 2) return null
    const name  = parts[0].trim()
    const phone = parts.slice(1).join(',').trim()
    return name && phone ? { name, phone } : null
  }).filter((c): c is { name: string; phone: string } => c !== null)
}

// ---------------------------------------------------------------------------
// Section header component
// ---------------------------------------------------------------------------
function SectionHeader({ label, sub }: { label: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 20, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--dim)' }}>
        {label}
      </span>
      {sub && <span style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--dim)' }}>{sub}</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Decision dot
// ---------------------------------------------------------------------------
const DECISION_COLOR: Record<string, string> = {
  interrupt: 'var(--green)',
  batch:     'var(--amber)',
  skip:      'var(--red)',
  silent:    'var(--dim)',
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function Configure() {
  const userId       = useAppStore((s) => s.userId)
  const viUserName   = useAppStore((s) => s.viUserName)
  const heartbeatLog = useAppStore((s) => s.heartbeatLog)

  // ── Profile state ──
  const [language,  setLanguage]  = useState('en')
  const [location,  setLocation]  = useState('')
  const [quietFrom, setQuietFrom] = useState('22:00')
  const [quietTo,   setQuietTo]   = useState('07:00')
  const [briefing,  setBriefing]  = useState(true)
  const [profileSaved, setProfileSaved] = useState(false)

  // ── Contacts state ──
  const [contacts,      setContacts]      = useState<Contact[]>([])
  const [newName,       setNewName]       = useState('')
  const [newPhone,      setNewPhone]      = useState('')
  const [addError,      setAddError]      = useState('')
  const [addLoading,    setAddLoading]    = useState(false)
  const [deleteTarget,  setDeleteTarget]  = useState<Contact | null>(null)
  const [showImport,    setShowImport]    = useState(false)
  const [bulkInput,     setBulkInput]     = useState('')
  const [bulkStatus,    setBulkStatus]    = useState('')
  const [bulkLoading,   setBulkLoading]   = useState(false)

  // ── Routines state ──
  const [routines, setRoutines] = useState<Routine[]>([])

  // ── Section refs for nav ──
  const profileRef  = useRef<HTMLDivElement>(null)
  const contactsRef = useRef<HTMLDivElement>(null)
  const scheduleRef = useRef<HTMLDivElement>(null)
  const activityRef = useRef<HTMLDivElement>(null)

  // ── Load profile ──
  useEffect(() => {
    if (!userId) return
    fetch(`/api/settings?userId=${userId}`, { headers: { Authorization: `Bearer ${apiToken()}` } })
      .then((r) => r.ok ? r.json() as Promise<{ language?: string; location?: string; quietFrom?: string; quietTo?: string; morningBriefing?: boolean }> : Promise.reject())
      .then((d) => {
        if (d.language)  setLanguage(d.language)
        if (d.location)  setLocation(d.location)
        if (d.quietFrom) setQuietFrom(d.quietFrom)
        if (d.quietTo)   setQuietTo(d.quietTo)
        if (typeof d.morningBriefing === 'boolean') setBriefing(d.morningBriefing)
      })
      .catch(() => {})
  }, [userId])

  // ── Load contacts ──
  const loadContacts = () => {
    if (!userId) return
    fetch(`/api/contacts?userId=${userId}`, { headers: { Authorization: `Bearer ${apiToken()}` } })
      .then((r) => r.ok ? r.json() as Promise<{ contacts?: Contact[] }> : Promise.reject())
      .then((d) => setContacts(d.contacts ?? []))
      .catch(() => {})
  }
  useEffect(loadContacts, [userId])

  // ── Load routines ──
  useEffect(() => {
    if (!userId) return
    fetch(`/api/routines?userId=${userId}`, { headers: { Authorization: `Bearer ${apiToken()}` } })
      .then((r) => r.ok ? r.json() as Promise<Routine[]> : Promise.reject())
      .then(setRoutines)
      .catch(() => {})
  }, [userId])

  // ── Profile save ──
  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault()
    await fetch('/api/settings', {
      method: 'POST',
      headers: authHdr(),
      body: JSON.stringify({ userId, language, location, quietFrom, quietTo, morningBriefing: briefing }),
    })
    setProfileSaved(true)
    setTimeout(() => setProfileSaved(false), 2000)
  }

  // ── Add contact ──
  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault()
    setAddError('')
    if (!newName.trim()) { setAddError('Name is required'); return }
    if (!/^\+\d{10,15}$/.test(newPhone.trim())) { setAddError('Use E.164 format, e.g. +27831000000'); return }
    if (!userId) { setAddError('No VI user linked'); return }
    setAddLoading(true)
    try {
      const res  = await fetch('/api/contacts', { method: 'POST', headers: authHdr(), body: JSON.stringify({ userId, name: newName.trim(), phone: newPhone.trim() }) })
      const json = await res.json() as { contact?: Contact; error?: string }
      if (!res.ok) { setAddError(json.error ?? 'Failed to add'); return }
      if (json.contact) setContacts((p) => [...p, json.contact!])
      setNewName(''); setNewPhone('')
    } catch { setAddError('Network error') }
    finally   { setAddLoading(false) }
  }

  // ── Toggle priority ──
  const handleTogglePriority = async (contact: Contact) => {
    await fetch(`/api/contacts/${contact.id}/priority`, {
      method: 'PATCH', headers: authHdr(),
      body: JSON.stringify({ is_priority: !contact.is_priority }),
    })
    loadContacts()
  }

  // ── Delete contact ──
  const handleDelete = async (contact: Contact) => {
    await fetch(`/api/contacts/${contact.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${apiToken()}` } })
    setDeleteTarget(null)
    loadContacts()
  }

  // ── Bulk import ──
  const handleBulkImport = async () => {
    if (!userId) return
    const entries = parseBulkInput(bulkInput)
    if (!entries.length) { setBulkStatus('No valid entries found'); return }
    setBulkLoading(true)
    setBulkStatus(`Importing ${entries.length}…`)
    let ok = 0, fail = 0
    for (const { name, phone } of entries) {
      try {
        const res  = await fetch('/api/contacts', { method: 'POST', headers: authHdr(), body: JSON.stringify({ userId, name, phone }) })
        const json = await res.json() as { contact?: Contact }
        if (json.contact) { setContacts((p) => [...p, json.contact!]); ok++ } else fail++
      } catch { fail++ }
    }
    setBulkInput('')
    setBulkLoading(false)
    setBulkStatus(`Done — ${ok} added${fail ? `, ${fail} skipped` : ''}`)
  }

  // ── Toggle routine ──
  const handleToggleRoutine = async (routine: Routine) => {
    await fetch(`/api/routines/${routine.id}`, {
      method: 'PATCH', headers: authHdr(),
      body: JSON.stringify({ enabled: !routine.enabled }),
    })
    setRoutines((prev) => prev.map((r) => r.id === routine.id ? { ...r, enabled: !r.enabled } : r))
  }

  // Section jump
  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>) =>
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const priorityCount = contacts.filter((c) => c.is_priority).length

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, minHeight: '100%' }}>

      {/* Topbar */}
      <div className="topbar" style={{ margin: '-32px -32px 0', position: 'sticky', top: -32, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="topbar-title">Configure</div>
          {viUserName && (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--mid)', letterSpacing: '0.08em', paddingLeft: 10, borderLeft: '1px solid var(--border)' }}>
              {viUserName.toUpperCase()}
            </div>
          )}
        </div>
        {/* Section jump nav */}
        <div style={{ display: 'flex', gap: 4 }}>
          {(['Profile', 'Contacts', 'Schedule', 'Activity'] as const).map((label, i) => {
            const refs = [profileRef, contactsRef, scheduleRef, activityRef]
            return (
              <button
                key={label}
                type="button"
                onClick={() => scrollTo(refs[i])}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700,
                  letterSpacing: '0.12em', textTransform: 'uppercase',
                  color: 'var(--mid)', padding: '4px 10px',
                  borderRadius: 'var(--radius-pill)',
                  transition: 'color 0.1s, background 0.1s',
                }}
                onMouseEnter={(e) => { (e.target as HTMLButtonElement).style.color = 'var(--white)'; (e.target as HTMLButtonElement).style.background = 'var(--bg3)' }}
                onMouseLeave={(e) => { (e.target as HTMLButtonElement).style.color = 'var(--mid)'; (e.target as HTMLButtonElement).style.background = 'none' }}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 48, paddingTop: 32 }}>

        {/* ── SECTION: Profile ── */}
        <section ref={profileRef}>
          <SectionHeader label="VI User" sub="Voice, language, and quiet hours" />
          <form onSubmit={handleProfileSave} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 560 }}>
            <div>
              <label className="field-label" htmlFor="cfg-language">Language</label>
              <select id="cfg-language" className="field-input" value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="en">English</option>
                <option value="af">Afrikaans</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="cfg-location">Location</label>
              <input id="cfg-location" type="text" className="field-input" placeholder="Johannesburg" value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <div>
              <label className="field-label" htmlFor="cfg-qfrom">Quiet from</label>
              <input id="cfg-qfrom" type="time" className="field-input" value={quietFrom} onChange={(e) => setQuietFrom(e.target.value)} />
            </div>
            <div>
              <label className="field-label" htmlFor="cfg-qto">Quiet until</label>
              <input id="cfg-qto" type="time" className="field-input" value={quietTo} onChange={(e) => setQuietTo(e.target.value)} />
            </div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px' }}>
              <span style={{ fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--white)' }}>Morning briefing</span>
              <button type="button" className="toggle" data-on={String(briefing)} onClick={() => setBriefing(!briefing)} aria-pressed={briefing}>
                <span className="toggle-knob" />
              </button>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <button type="submit" className="btn-primary" style={{ width: '100%' }}>
                {profileSaved ? '✓ Saved' : 'Save profile'}
              </button>
            </div>
          </form>
        </section>

        {/* ── SECTION: Contacts ── */}
        <section ref={contactsRef}>
          <SectionHeader
            label="Contacts"
            sub={contacts.length > 0 ? `${contacts.length} saved · ${priorityCount} priority` : 'No contacts yet'}
          />

          {/* Quick add */}
          <form onSubmit={handleAddContact} style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 130px' }}>
              <label className="field-label" htmlFor="cfg-cname">Name</label>
              <input id="cfg-cname" type="text" className="field-input" placeholder="Naledi" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div style={{ flex: '2 1 170px' }}>
              <label className="field-label" htmlFor="cfg-cphone">Phone (E.164)</label>
              <input id="cfg-cphone" type="tel" className="field-input" placeholder="+27835000000" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
            </div>
            <button type="submit" className="btn-primary" disabled={addLoading} style={{ whiteSpace: 'nowrap' }}>
              {addLoading ? '…' : '+ Add'}
            </button>
          </form>
          {addError && <p style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>{addError}</p>}

          {/* Import toggle */}
          <button
            type="button"
            onClick={() => setShowImport(!showImport)}
            style={{ fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: showImport ? 'var(--dim)' : 'var(--green)', background: 'none', border: `1px solid ${showImport ? 'var(--border)' : 'var(--green3)'}`, borderRadius: 'var(--radius-md)', padding: '6px 12px', cursor: 'pointer', marginBottom: 16 }}
          >
            {showImport ? 'Hide import' : 'Bulk import CSV / JSON'}
          </button>

          {showImport && (
            <div style={{ marginBottom: 16, padding: 16, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8 }}>
              <p style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--mid)', marginBottom: 10 }}>
                One contact per line: <code style={{ color: 'var(--white)' }}>Name, +27xxxxxxxxx</code> — or paste a JSON array
              </p>
              <textarea
                rows={5}
                className="field-input"
                style={{ width: '100%', fontFamily: 'var(--mono)', fontSize: 12, resize: 'vertical', height: 'auto' }}
                placeholder={'Naledi, +27835000000\nThabo, +27831234567'}
                value={bulkInput}
                onChange={(e) => setBulkInput(e.target.value)}
              />
              <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center' }}>
                <button type="button" className="btn-primary" disabled={bulkLoading || !bulkInput.trim()} onClick={handleBulkImport} style={{ whiteSpace: 'nowrap' }}>
                  {bulkLoading ? 'Importing…' : 'Import'}
                </button>
                {bulkStatus && <span style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--mid)' }}>{bulkStatus}</span>}
              </div>
            </div>
          )}

          {/* Contact list — cards */}
          {contacts.length === 0 ? (
            <p style={{ fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--dim)', fontStyle: 'italic' }}>
              No contacts yet. Add one above or say "add contact" via voice.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {contacts.map((c) => (
                <div
                  key={c.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 14px',
                    background: c.is_priority ? 'rgba(0,232,122,0.04)' : 'var(--bg2)',
                    border: `1px solid ${c.is_priority ? 'rgba(0,232,122,0.2)' : 'var(--border)'}`,
                    borderRadius: 6,
                    transition: 'border-color 0.2s, background 0.2s',
                  }}
                >
                  {/* Priority toggle */}
                  <button
                    type="button"
                    className="toggle"
                    data-on={String(c.is_priority)}
                    onClick={() => handleTogglePriority(c)}
                    aria-pressed={c.is_priority}
                    aria-label="Priority"
                    style={{ flexShrink: 0 }}
                  >
                    <span className="toggle-knob" />
                  </button>

                  {/* Name + phone */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 600, color: c.is_priority ? 'var(--white)' : 'var(--white)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {c.name}
                      {c.is_priority && <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--green)', letterSpacing: '0.1em' }}>PRIORITY</span>}
                    </div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--mid)', marginTop: 2 }}>{c.phone}</div>
                  </div>

                  {/* Delete */}
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(c)}
                    style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 13, padding: '4px 8px', borderRadius: 4, transition: 'color 0.1s' }}
                    onMouseEnter={(e) => { (e.currentTarget).style.color = 'var(--red)' }}
                    onMouseLeave={(e) => { (e.currentTarget).style.color = 'var(--dim)' }}
                    title="Remove contact"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── SECTION: Schedule ── */}
        <section ref={scheduleRef}>
          <SectionHeader label="Schedule" sub="Automated routines and digest timing" />

          {routines.length === 0 ? (
            <p style={{ fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--dim)', fontStyle: 'italic' }}>No routines configured.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {routines.map((r) => (
                <div
                  key={r.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '12px 14px',
                    background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6,
                    opacity: r.enabled ? 1 : 0.5,
                    transition: 'opacity 0.2s',
                  }}
                >
                  <button
                    type="button"
                    className="toggle"
                    data-on={String(r.enabled)}
                    onClick={() => handleToggleRoutine(r)}
                    aria-pressed={r.enabled}
                    style={{ flexShrink: 0 }}
                  >
                    <span className="toggle-knob" />
                  </button>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--white)' }}>{humanCron(r.cron)}</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)', marginTop: 2, letterSpacing: '0.06em' }}>{r.type.toUpperCase()} · {r.cron}</div>
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: r.enabled ? 'var(--green)' : 'var(--dim)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                    {r.enabled ? 'Active' : 'Off'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── SECTION: Activity ── */}
        <section ref={activityRef} style={{ paddingBottom: 40 }}>
          <SectionHeader
            label="Activity"
            sub={heartbeatLog.length > 0 ? `${heartbeatLog.length} events — live` : 'Waiting for WhatsApp messages'}
          />

          {heartbeatLog.length === 0 ? (
            <div style={{ padding: '28px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--dim)', animation: 'pulse 2s ease-in-out infinite' }} />
              <p style={{ fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--dim)' }}>No activity yet.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {heartbeatLog.slice(0, 20).map((e: HeartbeatEvent) => (
                <div
                  key={e.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '9px 14px',
                    background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6,
                  }}
                >
                  {/* Decision dot */}
                  <div style={{
                    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                    background: DECISION_COLOR[e.decision] ?? 'var(--dim)',
                    boxShadow: e.decision === 'interrupt' ? '0 0 4px rgba(0,232,122,0.5)' : 'none',
                  }} />

                  {/* Decision label */}
                  <div style={{
                    fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700,
                    letterSpacing: '0.1em', textTransform: 'uppercase',
                    color: DECISION_COLOR[e.decision] ?? 'var(--dim)',
                    width: 60, flexShrink: 0,
                  }}>
                    {e.decision}
                  </div>

                  {/* From */}
                  <div style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--white)', width: 100, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.from_phone}
                  </div>

                  {/* Preview */}
                  <div style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--mid)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.body_preview || '—'}
                  </div>

                  {/* Time */}
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)', flexShrink: 0 }}>
                    {relativeTime(e.timestamp)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

      </div>

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div style={{ background: 'var(--bg1)', padding: 28, borderRadius: 10, border: '1px solid var(--border)', maxWidth: 360, width: '90%' }}>
            <p style={{ fontFamily: 'var(--sans)', fontSize: 14, color: 'var(--white)', marginBottom: 8 }}>
              Remove <strong>{deleteTarget.name}</strong>?
            </p>
            <p style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--mid)', marginBottom: 24 }}>
              They will no longer receive or trigger notifications for this VI user.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn-primary" onClick={() => setDeleteTarget(null)} style={{ flex: 1 }}>Keep</button>
              <button type="button" className="btn-destructive" onClick={() => handleDelete(deleteTarget)} style={{ flex: 1 }}>Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
