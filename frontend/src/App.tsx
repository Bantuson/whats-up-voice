// frontend/src/App.tsx
// Sidebar: collapsed (48px icons-only) by default, expands to 200px on hover.
// Design matches root index.html — Space Mono/Grotesk, #0A0A0A bg, #00E87A green.
import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { Login }         from './pages/Login'
import { Setup }         from './pages/Setup'
import { Dashboard }     from './pages/Dashboard'
import { HeartbeatFeed } from './pages/HeartbeatFeed'
import { Contacts }      from './pages/Contacts'
import { Routines }      from './pages/Routines'
import { Log }           from './pages/Log'
import { useAppStore }   from './store/appStore'

const NAV_ITEMS = [
  { path: '/login',     label: 'Login',     icon: '◌' },
  { path: '/setup',     label: 'Setup',     icon: '◫' },
  { path: '/dashboard', label: 'Dashboard', icon: '◈' },
  { path: '/feed',      label: 'Feed',      icon: '◉' },
  { path: '/contacts',  label: 'Contacts',  icon: '◎' },
  { path: '/routines',  label: 'Routines',  icon: '◷' },
  { path: '/log',       label: 'Log',       icon: '◻' },
]

const STATE_LABELS: Record<string, string> = {
  idle:      'Idle',
  listening: 'Listening',
  composing: 'Composing',
  awaiting:  'Awaiting',
  playing:   'Playing',
}

export default function App() {
  const userId      = useAppStore((s) => s.userId)
  const phase       = useAppStore((s) => s.sessionPhase)

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

      </aside>

      {/* ── MAIN ── */}
      <main style={{ flex: 1, overflow: 'auto', padding: 'var(--space-xl)' }}>
        <Routes>
          <Route path="/login"     element={<Login />} />
          <Route path="/setup"     element={<Setup />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/feed"      element={<HeartbeatFeed />} />
          <Route path="/contacts"  element={<Contacts />} />
          <Route path="/routines"  element={<Routines />} />
          <Route path="/log"       element={<Log />} />
          <Route path="*"          element={<Navigate to={userId ? '/dashboard' : '/login'} replace />} />
        </Routes>
      </main>

    </div>
  )
}
