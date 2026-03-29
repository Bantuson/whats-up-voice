// frontend/src/App.tsx
// Sidebar: collapsed (48px icons-only) by default, expands to 200px on hover.
// Design matches root index.html — Space Mono/Grotesk, #0A0A0A bg, #00E87A green.
//
// Auth guard: if !isAuthenticated → redirect to /auth
// Nav items: DASHBOARD, FEED, CONTACTS, ROUTINES, LOG (LOGIN and SETUP removed)
// Setup: accessible via gear icon in sidebar footer (post-auth reconfiguration only)
import { useEffect }         from 'react'
import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { Auth }          from './pages/Auth'
import { Dashboard }     from './pages/Dashboard'
import { Configure }     from './pages/Configure'
import { Log }           from './pages/Log'
import { useAppStore }   from './store/appStore'

// Two primary modes: Live (voice view) and Configure (caregiver setup space).
// All other pages (Feed, Contacts, Routines, Setup, Podcasts) are consolidated into Configure.
const NAV_ITEMS = [
  { path: '/dashboard', label: 'Live',      icon: '◈' },
  { path: '/configure', label: 'Configure', icon: '⚙' },
]

const STATE_LABELS: Record<string, string> = {
  idle:      'Idle',
  listening: 'Listening',
  composing: 'Composing',
  awaiting:  'Awaiting',
  playing:   'Playing',
}

export default function App() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated)
  const authLoading     = useAppStore((s) => s.authLoading)
  const phase           = useAppStore((s) => s.sessionPhase)
  const initAuth        = useAppStore((s) => s.initAuth)
  const signOut         = useAppStore((s) => s.signOut)

  // Rehydrate Supabase session from localStorage on mount
  useEffect(() => {
    let cleanup: (() => void) | undefined
    initAuth().then((fn) => { cleanup = fn })
    return () => { cleanup?.() }
  }, [initAuth])

  // Block render until initAuth resolves — prevents flash to /auth on page load
  if (authLoading) return null

  // Pre-auth: show only the auth page (no sidebar)
  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="*"    element={<Navigate to="/auth" replace />} />
      </Routes>
    )
  }

  // Post-auth: full dashboard with sidebar
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>

      {/* ── SIDEBAR ── */}
      <aside className="sidebar">

        {/* Logo */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-mark">VoiceApp</div>
          <div className="sidebar-logo-sub">Audio interface</div>
        </div>

        {/* Nav */}
        <nav className="sidebar-nav">
          {NAV_ITEMS.map(({ path, label, icon }) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')}
            >
              <span className="sidebar-icon">{icon}</span>
              <span className="sidebar-label">{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Agent state panel */}
        <div className="sidebar-state">
          <div className="sidebar-state-label">Agent state</div>
          <div className="sidebar-state-row">
            <div className={`state-dot ${phase}`} />
            <span className={`sidebar-state-name ${phase}`}>
              {STATE_LABELS[phase] ?? phase}
            </span>
          </div>
        </div>

        {/* Sidebar footer: dev log link + sign-out */}
        <div style={{ marginTop: 'auto', padding: 'var(--space-md)', borderTop: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
          <NavLink
            to="/log"
            title="Dev log"
            className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')}
            style={{ flex: 1, opacity: 0.5 }}
          >
            <span className="sidebar-icon">◻</span>
            <span className="sidebar-label">Dev log</span>
          </NavLink>
          <button
            onClick={() => signOut()}
            title="Sign out"
            style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontFamily: 'var(--font-data)', fontSize: 'var(--size-label)', padding: 'var(--space-sm)' }}
          >
            ⏻
          </button>
        </div>

      </aside>

      {/* ── MAIN ── */}
      <main style={{ flex: 1, overflow: 'auto', padding: 'var(--space-xl)' }}>
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/configure" element={<Configure />} />
          <Route path="/log"       element={<Log />} />
          {/* Legacy routes redirect to the consolidated views */}
          <Route path="/feed"      element={<Navigate to="/configure" replace />} />
          <Route path="/contacts"  element={<Navigate to="/configure" replace />} />
          <Route path="/routines"  element={<Navigate to="/configure" replace />} />
          <Route path="/setup"     element={<Navigate to="/configure" replace />} />
          <Route path="/podcasts"  element={<Navigate to="/configure" replace />} />
          <Route path="/auth"      element={<Navigate to="/dashboard" replace />} />
          <Route path="*"          element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>

    </div>
  )
}
