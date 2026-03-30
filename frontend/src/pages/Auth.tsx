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
    width: 460,
    background: 'var(--color-surface)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    overflow: 'hidden',
  }

  const wrapStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: 'var(--bg)',
  }

  const stepLabel: Record<Step, string> = {
    'email':     'Step 1 of 2 — Caregiver sign-in',
    'email-otp': 'Step 1 of 2 — Enter email code',
    'phone':     caregiverId ? 'Register VI user' : 'Step 2 of 2 — Register VI user',
  }

  return (
    <div style={wrapStyle}>
      <div style={cardStyle}>

        {/* ── Brand header ── */}
        <div style={{
          background: '#0A0A0A',
          borderBottom: '1px solid #1a1a1a',
          padding: '32px 40px 28px',
          display: 'flex',
          alignItems: 'center',
          gap: 24,
        }}>
          {/* Icon */}
          <svg width="56" height="56" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
            <rect width="64" height="64" rx="16" fill="#0A0A0A"/>
            <path d="M13 22 Q13 14 21 14 L43 14 Q51 14 51 22 L51 38 Q51 46 43 46 L34 46 L27 53 L27 46 L21 46 Q13 46 13 38 Z" fill="#0D1F14" stroke="#00E87A" strokeWidth="1.2" strokeOpacity="0.7"/>
            <line x1="23" y1="30" x2="23" y2="30" stroke="#00E87A" strokeWidth="2.2" strokeLinecap="round" opacity="0.35"/>
            <line x1="28" y1="25" x2="28" y2="35" stroke="#00E87A" strokeWidth="2.2" strokeLinecap="round" opacity="0.6"/>
            <line x1="32" y1="21" x2="32" y2="39" stroke="#00E87A" strokeWidth="2.2" strokeLinecap="round"/>
            <line x1="37" y1="25" x2="37" y2="35" stroke="#00E87A" strokeWidth="2.2" strokeLinecap="round" opacity="0.7"/>
            <line x1="41" y1="28" x2="41" y2="32" stroke="#00E87A" strokeWidth="2.2" strokeLinecap="round" opacity="0.45"/>
          </svg>

          {/* Wordmark */}
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
            <span style={{ fontFamily: 'var(--font-prose)', fontWeight: 300, fontSize: 18, letterSpacing: '0.01em', color: '#888' }}>what's up</span>
            <span style={{ fontFamily: 'var(--font-prose)', fontWeight: 700, fontSize: 34, letterSpacing: '-0.03em', color: '#00E87A', marginTop: -2 }}>Voice</span>
            <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#333', marginTop: 5 }}>Audio-first · WhatsApp</span>
          </div>

          {/* Divider */}
          <div style={{ width: 1, height: 56, background: '#1e1e1e', flexShrink: 0, marginLeft: 4 }} />

          {/* Tagline */}
          <div style={{ fontFamily: 'var(--font-prose)', fontSize: 12, color: '#444', fontWeight: 300, letterSpacing: '0.01em', lineHeight: 1.7 }}>
            Your voice.<br/>Your contacts.<br/>Zero screen.
          </div>
        </div>

        {/* ── Form body ── */}
        <div style={{ padding: '28px 40px 36px' }}>
          <p style={{ fontFamily: 'var(--font-data)', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xl)' }}>
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
        </div>{/* /form body */}
      </div>
    </div>
  )
}
