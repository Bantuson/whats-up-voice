// frontend/src/pages/Auth.tsx
// Two-step auth gate. Always operated by the caregiver on behalf of the VI user.
//
// Step 1 — Caregiver identity (Supabase email OTP):
//   a. Enter email → signIn(email) → Supabase sends 8-digit code to email
//   b. Enter 8-digit code → verifyOtp(email, code) → caregiver session established
//
// Step 2 — VI user registration (no SMS — caregiver vouches for the number):
//   a. Enter VI user phone + display name → POST /api/auth/link-vi-user → caregiver_links row created
//   b. Redirect to /dashboard
//
// Shown only when !isAuthenticated (App.tsx redirects here automatically).
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../store/appStore'

type Step = 'email' | 'email-otp' | 'phone'

export function Auth() {
  const navigate = useNavigate()
  const { signIn, verifyOtp, linkViUser } = useAppStore()
  const caregiverId = useAppStore((s) => s.caregiverId)

  // If caregiver session already exists, skip email OTP and go straight to VI user setup
  const [step, setStep]         = useState<Step>(() => caregiverId ? 'phone' : 'email')
  const [email, setEmail]       = useState('')
  const [emailOtp, setEmailOtp] = useState('')
  const [phone, setPhone]       = useState('')
  const [name, setName]         = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.')
      return
    }
    setLoading(true)
    try {
      await signIn(email.trim())
      setStep('email-otp')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send code. Try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleEmailOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!/^\d{8}$/.test(emailOtp.trim())) {
      setError('Enter the 8-digit code from your email.')
      return
    }
    setLoading(true)
    try {
      await verifyOtp(email.trim(), emailOtp.trim())
      setStep('phone')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code. Check your email and try again.')
    } finally {
      setLoading(false)
    }
  }

  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!/^\+\d{10,15}$/.test(phone.trim())) {
      setError('Enter the VI user phone in international format, e.g. +27831000000.')
      return
    }
    if (!name.trim()) {
      setError('Enter a display name for the VI user.')
      return
    }
    setLoading(true)
    try {
      await linkViUser(phone.trim(), name.trim())
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save VI user. Try again.')
    } finally {
      setLoading(false)
    }
  }

  const cardStyle: React.CSSProperties = {
    width: 380,
    background: 'var(--color-surface)',
    padding: 'var(--space-xl)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
  }

  const wrapStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
  }

  const stepLabel: Record<Step, string> = {
    'email':     'Step 1 of 2 — Caregiver sign-in',
    'email-otp': 'Step 1 of 2 — Enter email code',
    'phone':     caregiverId ? 'Register VI user' : 'Step 2 of 2 — Register VI user',
  }

  return (
    <div style={wrapStyle}>
      <div style={cardStyle}>
        <h1 style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--size-heading)', fontWeight: 600, color: 'var(--color-accent)', marginBottom: 'var(--space-sm)' }}>
          VoiceApp
        </h1>
        <p style={{ fontFamily: 'var(--font-prose)', fontSize: 'var(--size-body)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-2xl)' }}>
          {stepLabel[step]}
        </p>

        {error && (
          <p style={{ color: 'var(--color-destructive)', fontFamily: 'var(--font-prose)', fontSize: 'var(--size-label)', marginBottom: 'var(--space-md)' }}>
            {error}
          </p>
        )}

        {/* Step 1a — email */}
        {step === 'email' && (
          <form onSubmit={handleEmailSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <div>
              <label className="field-label" htmlFor="email">Your email address</label>
              <input
                id="email" type="email" className="field-input"
                placeholder="you@example.com"
                value={email} onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Sending…' : 'Send code'}
            </button>
          </form>
        )}

        {/* Step 1b — email OTP */}
        {step === 'email-otp' && (
          <form onSubmit={handleEmailOtpSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <p style={{ fontFamily: 'var(--font-prose)', fontSize: 'var(--size-body)', color: 'var(--color-text)' }}>
              Check <strong>{email}</strong> for an 8-digit code.
            </p>
            <div>
              <label className="field-label" htmlFor="emailOtp">8-digit code</label>
              <input
                id="emailOtp" type="text" className="field-input"
                placeholder="00000000"
                maxLength={8}
                value={emailOtp} onChange={(e) => setEmailOtp(e.target.value.replace(/\D/g, ''))}
                autoComplete="one-time-code"
                inputMode="numeric"
              />
            </div>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Verifying…' : 'Verify'}
            </button>
            <button
              type="button"
              onClick={() => { setStep('email'); setEmailOtp(''); setError('') }}
              style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', fontFamily: 'var(--font-prose)', fontSize: 'var(--size-label)', cursor: 'pointer', textAlign: 'left' }}
            >
              Back
            </button>
          </form>
        )}

        {/* Step 2 — VI user phone + name (no SMS verification) */}
        {step === 'phone' && (
          <form onSubmit={handlePhoneSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <p style={{ fontFamily: 'var(--font-prose)', fontSize: 'var(--size-body)', color: 'var(--color-text)' }}>
              Enter the WhatsApp number and display name for the visually impaired user you support.
            </p>
            <div>
              <label className="field-label" htmlFor="viName">Display name</label>
              <input
                id="viName" type="text" className="field-input"
                placeholder="e.g. Nomsa"
                value={name} onChange={(e) => setName(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="viPhone">Phone number</label>
              <input
                id="viPhone" type="tel" className="field-input"
                placeholder="+27 83 100 0000"
                value={phone} onChange={(e) => setPhone(e.target.value)}
                autoComplete="off"
              />
            </div>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Saving…' : 'Confirm'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
