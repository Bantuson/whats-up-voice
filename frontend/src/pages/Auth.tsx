// frontend/src/pages/Auth.tsx
// Two-step auth gate. Always operated by the caregiver on behalf of the VI user.
//
// Step 1 — Caregiver identity (Supabase email OTP):
//   a. Enter email → signIn(email) → Supabase sends 6-digit code to email
//   b. Enter 6-digit code → verifyOtp(email, code) → caregiver session established
//
// Step 2 — VI user registration (Twilio SMS 4-digit OTP):
//   a. Enter VI user phone + display name → POST /api/auth/send-otp → Twilio sends SMS
//   b. Enter 4-digit code → linkViUser(phone, name, code) → caregiver_links row created
//   c. Redirect to /dashboard
//
// Shown only when !isAuthenticated (App.tsx redirects here automatically).
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../store/appStore'

type Step = 'email' | 'email-otp' | 'phone' | 'phone-otp'

const apiBase = () =>
  (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:3000'

const apiToken = () =>
  (import.meta.env.VITE_API_TOKEN as string | undefined) ?? ''

export function Auth() {
  const navigate = useNavigate()
  const { signIn, verifyOtp, linkViUser } = useAppStore()

  const [step, setStep]       = useState<Step>('email')
  const [email, setEmail]     = useState('')
  const [emailOtp, setEmailOtp] = useState('')
  const [phone, setPhone]     = useState('')
  const [name, setName]       = useState('')
  const [phoneOtp, setPhoneOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

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
    if (!/^\d{6}$/.test(emailOtp.trim())) {
      setError('Enter the 6-digit code from your email.')
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
      const res = await fetch(`${apiBase()}/api/auth/send-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken()}`,
        },
        body: JSON.stringify({ phone: phone.trim() }),
      })
      const json = await res.json() as { sent?: boolean; error?: string }
      if (!res.ok || !json.sent) {
        setError(json.error ?? 'Failed to send SMS. Check the phone number and try again.')
        return
      }
      setStep('phone-otp')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SMS send failed. Try again.')
    } finally {
      setLoading(false)
    }
  }

  const handlePhoneOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!/^\d{4}$/.test(phoneOtp.trim())) {
      setError('Enter the 4-digit code sent to the VI user phone.')
      return
    }
    setLoading(true)
    try {
      await linkViUser(phone.trim(), name.trim(), phoneOtp.trim())
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code. Ask the VI user to check their SMS.')
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
    'phone':     'Step 2 of 2 — Register VI user',
    'phone-otp': 'Step 2 of 2 — Verify VI user phone',
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
              Check <strong>{email}</strong> for a 6-digit code.
            </p>
            <div>
              <label className="field-label" htmlFor="emailOtp">6-digit code</label>
              <input
                id="emailOtp" type="text" className="field-input"
                placeholder="000000"
                maxLength={6}
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

        {/* Step 2a — VI user phone + name */}
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
              {loading ? 'Sending SMS…' : 'Send verification code'}
            </button>
          </form>
        )}

        {/* Step 2b — 4-digit SMS OTP */}
        {step === 'phone-otp' && (
          <form onSubmit={handlePhoneOtpSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <p style={{ fontFamily: 'var(--font-prose)', fontSize: 'var(--size-body)', color: 'var(--color-text)' }}>
              A 4-digit code was sent to <strong>{phone}</strong>. Enter it below.
            </p>
            <div>
              <label className="field-label" htmlFor="phoneOtp">4-digit code</label>
              <input
                id="phoneOtp" type="text" className="field-input"
                placeholder="0000"
                maxLength={4}
                value={phoneOtp} onChange={(e) => setPhoneOtp(e.target.value.replace(/\D/g, ''))}
                autoComplete="one-time-code"
                inputMode="numeric"
              />
            </div>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Verifying…' : 'Complete setup'}
            </button>
            <button
              type="button"
              onClick={() => { setStep('phone'); setPhoneOtp(''); setError('') }}
              style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', fontFamily: 'var(--font-prose)', fontSize: 'var(--size-label)', cursor: 'pointer', textAlign: 'left' }}
            >
              Back
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
