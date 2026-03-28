// frontend/src/pages/Setup.tsx
// Post-auth configuration wizard.
// Section A: VI user profile (language, location, quiet hours, briefing) — unchanged.
// Section B: Contact management (manual entry, native/CSV import, list with delete).
import { useState, useEffect } from 'react'
import { useAppStore } from '../store/appStore'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Contact {
  id: string
  name: string
  phone: string
  is_priority: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const apiBase = () =>
  (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:3000'

const apiToken = () =>
  (import.meta.env.VITE_API_TOKEN as string | undefined) ?? ''

const authHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${apiToken()}`,
})

function hasNativeContacts(): boolean {
  return 'contacts' in navigator && 'ContactsManager' in window
}

// Parses CSV (Name, +27xxx) or JSON array [{ name, phone }] from textarea
function parseBulkInput(raw: string): { name: string; phone: string }[] {
  const trimmed = raw.trim()
  if (!trimmed) return []

  // Try JSON first
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown[]
      return parsed
        .filter((item): item is { name: string; phone: string } =>
          typeof item === 'object' && item !== null && 'name' in item && 'phone' in item
        )
        .map((item) => ({ name: String(item.name).trim(), phone: String(item.phone).trim() }))
        .filter((c) => c.name && c.phone)
    } catch {
      // fall through to CSV
    }
  }

  // CSV: each line is "Name, +27xxxxxxxxx" (comma-separated)
  return trimmed
    .split('\n')
    .map((line) => {
      const parts = line.split(',')
      if (parts.length < 2) return null
      const name  = parts[0].trim()
      const phone = parts.slice(1).join(',').trim()
      if (!name || !phone) return null
      return { name, phone }
    })
    .filter((c): c is { name: string; phone: string } => c !== null)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function Setup() {
  const userId = useAppStore((s) => s.userId)

  // -- Section A state --
  const [language,  setLanguage]  = useState('en')
  const [location,  setLocation]  = useState('')
  const [quietFrom, setQuietFrom] = useState('22:00')
  const [quietTo,   setQuietTo]   = useState('07:00')
  const [briefing,  setBriefing]  = useState(true)
  const [saved,     setSaved]     = useState(false)

  // -- Section B state --
  const [contacts,      setContacts]      = useState<Contact[]>([])
  const [newName,       setNewName]       = useState('')
  const [newPhone,      setNewPhone]      = useState('')
  const [addError,      setAddError]      = useState('')
  const [addLoading,    setAddLoading]    = useState(false)
  const [showImport,    setShowImport]    = useState(false)
  const [bulkInput,     setBulkInput]     = useState('')
  const [bulkStatus,    setBulkStatus]    = useState('')
  const [bulkLoading,   setBulkLoading]   = useState(false)
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null)

  // Load contacts on mount / when userId changes
  useEffect(() => {
    if (!userId) return
    fetch(`${apiBase()}/api/contacts?userId=${encodeURIComponent(userId)}`, {
      headers: { 'Authorization': `Bearer ${apiToken()}` },
    })
      .then((r) => r.json())
      .then((json: { contacts?: Contact[] }) => {
        if (json.contacts) setContacts(json.contacts)
      })
      .catch(() => {/* non-critical — list just stays empty */})
  }, [userId])

  // -- Section A handler --
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    const token = apiToken()
    await fetch(`${apiBase()}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ userId, language, location, quietFrom, quietTo, morningBriefing: briefing }),
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  // -- Section B: manual add --
  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault()
    setAddError('')
    if (!newName.trim()) { setAddError('Name is required.'); return }
    if (!/^\+\d{10,15}$/.test(newPhone.trim())) {
      setAddError('Phone must be in E.164 format, e.g. +27831000000.')
      return
    }
    if (!userId) { setAddError('No VI user linked. Complete setup first.'); return }

    setAddLoading(true)
    try {
      const res = await fetch(`${apiBase()}/api/contacts`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ userId, name: newName.trim(), phone: newPhone.trim() }),
      })
      const json = await res.json() as { contact?: Contact; error?: string }
      if (!res.ok) { setAddError(json.error ?? 'Failed to add contact.'); return }
      if (json.contact) setContacts((prev) => [...prev, json.contact!])
      setNewName('')
      setNewPhone('')
    } catch {
      setAddError('Network error. Try again.')
    } finally {
      setAddLoading(false)
    }
  }

  // -- Section B: delete --
  const handleDelete = async (contactId: string) => {
    setDeleteLoading(contactId)
    try {
      await fetch(`${apiBase()}/api/contacts/${encodeURIComponent(contactId)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${apiToken()}` },
      })
      setContacts((prev) => prev.filter((c) => c.id !== contactId))
    } catch {
      // silently ignore — the contact will reload on next mount
    } finally {
      setDeleteLoading(null)
    }
  }

  // -- Section B: native contacts import --
  const handleNativeImport = async () => {
    if (!userId) return
    try {
      // navigator.contacts.select is not typed in lib.dom.d.ts — use unknown cast
      type ContactsManager = {
        select: (props: string[], opts: { multiple: boolean }) => Promise<{ name?: string[]; tel?: string[] }[]>
      }
      const mgr = (navigator as unknown as { contacts: ContactsManager }).contacts
      const results = await mgr.select(['name', 'tel'], { multiple: true })
      const toImport = results
        .filter((r) => r.name?.[0] && r.tel?.[0])
        .map((r) => ({ name: r.name![0].trim(), phone: r.tel![0].trim() }))

      for (const { name, phone } of toImport) {
        try {
          const res = await fetch(`${apiBase()}/api/contacts`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ userId, name, phone }),
          })
          const json = await res.json() as { contact?: Contact }
          if (json.contact) setContacts((prev) => [...prev, json.contact!])
        } catch { /* skip failed individual imports */ }
      }
    } catch { /* user cancelled picker or error */ }
  }

  // -- Section B: bulk CSV/JSON import --
  const handleBulkImport = async () => {
    if (!userId) return
    const entries = parseBulkInput(bulkInput)
    if (entries.length === 0) { setBulkStatus('No valid entries found. Check format.'); return }

    setBulkLoading(true)
    setBulkStatus(`Importing ${entries.length} contacts…`)
    let imported = 0
    let failed = 0

    for (const { name, phone } of entries) {
      try {
        const res = await fetch(`${apiBase()}/api/contacts`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ userId, name, phone }),
        })
        const json = await res.json() as { contact?: Contact }
        if (json.contact) {
          setContacts((prev) => [...prev, json.contact!])
          imported++
        } else {
          failed++
        }
      } catch { failed++ }
    }

    setBulkInput('')
    setBulkLoading(false)
    setBulkStatus(`Done: ${imported} imported${failed > 0 ? `, ${failed} failed (duplicates or invalid numbers)` : ''}.`)
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--size-heading)', fontWeight: 600, color: 'var(--color-text)', marginBottom: 'var(--space-2xl)' }}>
        Setup
      </h1>

      {/* ── SECTION A: VI User Profile ── */}
      <section style={{ marginBottom: 'var(--space-2xl)' }}>
        <h2 style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--size-body)', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 'var(--space-md)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          A — VI User Profile
        </h2>
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
      </section>

      {/* ── SECTION B: Contact List ── */}
      <section style={{ maxWidth: 560 }}>
        <h2 style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--size-body)', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 'var(--space-md)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          B — Contacts
        </h2>

        {/* Manual entry form */}
        <form onSubmit={handleAddContact} style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 140px' }}>
            <label className="field-label" htmlFor="cName">Name</label>
            <input id="cName" type="text" className="field-input" placeholder="Naledi" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
          <div style={{ flex: '2 1 180px' }}>
            <label className="field-label" htmlFor="cPhone">Phone (E.164)</label>
            <input id="cPhone" type="tel" className="field-input" placeholder="+27835000000" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
          </div>
          <div style={{ alignSelf: 'flex-end' }}>
            <button type="submit" className="btn-primary" disabled={addLoading} style={{ whiteSpace: 'nowrap' }}>
              {addLoading ? 'Adding…' : 'Add contact'}
            </button>
          </div>
        </form>
        {addError && (
          <p style={{ color: 'var(--color-destructive)', fontFamily: 'var(--font-prose)', fontSize: 'var(--size-label)', marginBottom: 'var(--space-sm)' }}>
            {addError}
          </p>
        )}

        {/* Import button (native or CSV fallback) */}
        <div style={{ marginBottom: 'var(--space-md)' }}>
          <button
            type="button"
            onClick={hasNativeContacts() ? handleNativeImport : () => setShowImport(!showImport)}
            style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--size-label)', color: 'var(--color-accent)', background: 'none', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-md)', padding: 'var(--space-sm) var(--space-md)', cursor: 'pointer' }}
          >
            {hasNativeContacts() ? 'Import from device' : (showImport ? 'Hide import' : 'Import from file / paste')}
          </button>
        </div>

        {/* CSV/JSON textarea (shown when native contacts not available) */}
        {!hasNativeContacts() && showImport && (
          <div style={{ marginBottom: 'var(--space-md)', padding: 'var(--space-md)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
            <p style={{ fontFamily: 'var(--font-prose)', fontSize: 'var(--size-label)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-sm)' }}>
              Paste CSV (one per line: <code>Name, +27xxxxxxxxx</code>) or JSON array (<code>[&#123;"name":"...","phone":"..."&#125;]</code>)
            </p>
            <textarea
              rows={6}
              className="field-input"
              style={{ width: '100%', fontFamily: 'var(--font-data)', fontSize: 'var(--size-label)', resize: 'vertical' }}
              placeholder={'Naledi, +27835000000\nThabo, +27831234567'}
              value={bulkInput}
              onChange={(e) => setBulkInput(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)', alignItems: 'center' }}>
              <button
                type="button"
                className="btn-primary"
                disabled={bulkLoading || !bulkInput.trim()}
                onClick={handleBulkImport}
              >
                {bulkLoading ? 'Importing…' : 'Import'}
              </button>
              {bulkStatus && (
                <span style={{ fontFamily: 'var(--font-prose)', fontSize: 'var(--size-label)', color: 'var(--color-text-muted)' }}>
                  {bulkStatus}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Existing contacts list */}
        {contacts.length === 0 ? (
          <p style={{ fontFamily: 'var(--font-prose)', fontSize: 'var(--size-body)', color: 'var(--color-text-muted)' }}>
            No contacts yet. Add one above or ask the VI user to say "add contact" via WhatsApp.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {contacts.map((c) => (
              <li
                key={c.id}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-sm) var(--space-md)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}
              >
                <div>
                  <span style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--size-body)', color: 'var(--color-text)', marginRight: 'var(--space-sm)' }}>
                    {c.name}
                  </span>
                  {c.is_priority && (
                    <span style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--size-label)', color: 'var(--color-accent)' }}>★</span>
                  )}
                  <br />
                  <span style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--size-label)', color: 'var(--color-text-muted)' }}>
                    {c.phone}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(c.id)}
                  disabled={deleteLoading === c.id}
                  style={{ background: 'none', border: 'none', color: 'var(--color-destructive)', cursor: 'pointer', fontFamily: 'var(--font-data)', fontSize: 'var(--size-label)', padding: 'var(--space-sm)' }}
                  title="Delete contact"
                >
                  {deleteLoading === c.id ? '…' : '✕'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
