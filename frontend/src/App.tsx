// frontend/src/App.tsx
// 7-page SPA with fixed left nav sidebar (160px) and React Router hash-based routing.
// Nav items: LOGIN SETUP DASHBOARD FEED CONTACTS ROUTINES LOG (uppercase per spec)
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
  { path: '/login',     label: 'LOGIN'    },
  { path: '/setup',     label: 'SETUP'    },
  { path: '/dashboard', label: 'DASHBOARD'},
  { path: '/feed',      label: 'FEED'     },
  { path: '/contacts',  label: 'CONTACTS' },
  { path: '/routines',  label: 'ROUTINES' },
  { path: '/log',       label: 'LOG'      },
]

export default function App() {
  const userId = useAppStore((s) => s.userId)
  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* Nav sidebar — fixed 160px, #1A1A1A bg */}
      <nav style={{
        width: 160, minHeight: '100vh', background: 'var(--color-surface)',
        display: 'flex', flexDirection: 'column', flexShrink: 0,
      }}>
        <div style={{ padding: 'var(--space-lg) var(--space-md)', borderBottom: '1px solid var(--color-border)' }}>
          <span style={{
            fontFamily: 'var(--font-data)', fontSize: 'var(--size-label)',
            fontWeight: 'var(--weight-semibold)', color: 'var(--color-accent)',
          }}>
            VoiceApp
          </span>
        </div>
        {NAV_ITEMS.map(({ path, label }) => (
          <NavLink
            key={path}
            to={path}
            style={({ isActive }) => ({
              display: 'flex', alignItems: 'center',
              height: 'var(--touch-target)',
              padding: '0 var(--space-md)',
              fontFamily: 'var(--font-prose)',
              fontSize: 'var(--size-label)',
              fontWeight: 'var(--weight-semibold)',
              textDecoration: 'none',
              letterSpacing: '0.08em',
              color: isActive ? 'var(--color-accent)' : 'var(--color-text-muted)',
              borderLeft: isActive ? '2px solid var(--color-accent)' : '2px solid transparent',
            })}
          >
            {label}
          </NavLink>
        ))}
      </nav>
      {/* Page content */}
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
