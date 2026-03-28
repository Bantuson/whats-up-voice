import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../store/appStore'

export function Login() {
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const setUserId = useAppStore((s) => s.setUserId)
  const navigate = useNavigate()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = phone.trim()
    if (!/^\+\d{10,15}$/.test(trimmed)) {
      setError('Enter a valid phone number in international format, e.g. +27831000000.')
      return
    }
    setUserId(trimmed)
    navigate('/dashboard')
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--color-bg)' }}>
      <div style={{ width: 360, background: 'var(--color-surface)', padding: 'var(--space-xl)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
        <h1 style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--size-heading)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-accent)', marginBottom: 'var(--space-sm)' }}>
          VoiceApp
        </h1>
        <p style={{ fontFamily: 'var(--font-prose)', fontSize: 'var(--size-body)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-2xl)' }}>
          Caregiver Dashboard
        </p>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 'var(--space-md)' }}>
            <label className="field-label" htmlFor="phone">Phone number</label>
            <input
              id="phone" type="tel" className="field-input"
              placeholder="+27 83 100 0000"
              value={phone} onChange={(e) => setPhone(e.target.value)}
            />
            {error && <p style={{ color: 'var(--color-destructive)', fontFamily: 'var(--font-prose)', fontSize: 'var(--size-label)', marginTop: 'var(--space-sm)' }}>{error}</p>}
          </div>
          <button type="submit" className="btn-primary" style={{ width: '100%' }}>Connect</button>
        </form>
      </div>
    </div>
  )
}
