import { useState, useEffect } from 'react'
import { useAppStore } from '../store/appStore'

interface Contact {
  id: string
  name: string
  phone: string
  is_priority: boolean
}

export function Contacts() {
  const userId = useAppStore((s) => s.userId)
  const token = import.meta.env.VITE_API_TOKEN ?? ''
  const [contacts, setContacts] = useState<Contact[]>([])
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<Contact | null>(null)

  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }

  const loadContacts = async () => {
    const res = await fetch(`/api/contacts?userId=${userId}`, { headers })
    if (res.ok) {
      const data = await res.json() as Contact[]
      setContacts(data)
    }
  }

  useEffect(() => { void loadContacts() }, [userId])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !phone.trim()) return
    await fetch('/api/contacts', {
      method: 'POST',
      headers,
      body: JSON.stringify({ userId, name: name.trim(), phone: phone.trim() }),
    })
    setName('')
    setPhone('')
    void loadContacts()
  }

  const handleTogglePriority = async (contact: Contact) => {
    await fetch(`/api/contacts/${contact.id}/priority`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ is_priority: !contact.is_priority }),
    })
    void loadContacts()
  }

  const handleDelete = async (contact: Contact) => {
    await fetch(`/api/contacts/${contact.id}`, { method: 'DELETE', headers })
    setConfirmDelete(null)
    void loadContacts()
  }

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--size-heading)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)', marginBottom: 'var(--space-2xl)' }}>
        Contacts
      </h1>

      {contacts.length === 0 ? (
        <p style={{ fontFamily: 'var(--font-prose)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-2xl)' }}>
          No contacts saved. Add the first contact below.
        </p>
      ) : (
        <table className="data-table" style={{ marginBottom: 'var(--space-2xl)' }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Priority</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((contact) => (
              <tr key={contact.id}>
                <td style={{ fontFamily: 'var(--font-prose)' }}>{contact.name}</td>
                <td>{contact.phone}</td>
                <td>
                  <button
                    type="button"
                    className="toggle"
                    data-on={String(contact.is_priority)}
                    onClick={() => handleTogglePriority(contact)}
                    aria-pressed={contact.is_priority}
                    aria-label="Priority"
                  >
                    <span className="toggle-knob" />
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    className="btn-destructive"
                    onClick={() => setConfirmDelete(contact)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Add Contact form */}
      <h2 style={{ fontFamily: 'var(--font-prose)', fontSize: 'var(--size-label)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: 'var(--space-md)' }}>
        Add Contact
      </h2>
      <form onSubmit={handleAdd} style={{ display: 'flex', gap: 'var(--space-md)', maxWidth: 600, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <label className="field-label" htmlFor="contact-name">Name</label>
          <input id="contact-name" type="text" className="field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Contact name" />
        </div>
        <div style={{ flex: 1 }}>
          <label className="field-label" htmlFor="contact-phone">Phone</label>
          <input id="contact-phone" type="tel" className="field-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+27831000000" />
        </div>
        <button type="submit" className="btn-primary">Add Contact</button>
      </form>

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: 'var(--color-surface)', padding: 'var(--space-xl)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', maxWidth: 400, width: '100%' }}>
            <p style={{ fontFamily: 'var(--font-prose)', fontSize: 'var(--size-body)', color: 'var(--color-text)', marginBottom: 'var(--space-xl)' }}>
              Delete {confirmDelete.name}? This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
              <button type="button" className="btn-primary" onClick={() => setConfirmDelete(null)} style={{ flex: 1 }}>Cancel</button>
              <button type="button" className="btn-destructive" onClick={() => handleDelete(confirmDelete)} style={{ flex: 1 }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
