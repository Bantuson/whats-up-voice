import { useState, useEffect } from 'react'
import { useAppStore } from '../store/appStore'

interface Routine {
  id: string
  label: string
  cron: string
  type: string
  enabled: boolean
}

function humanReadableCron(cron: string): string {
  if (cron === '0 7 * * 1-5') return 'Weekdays at 7:00 AM'
  if (cron === '0 18 * * *') return 'Daily at 6:00 PM'
  return cron
}

export function Routines() {
  const userId = useAppStore((s) => s.userId)
  const token = import.meta.env.VITE_API_TOKEN ?? ''
  const [routines, setRoutines] = useState<Routine[]>([])

  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }

  const loadRoutines = async () => {
    const res = await fetch(`/api/routines?userId=${userId}`, { headers })
    if (res.ok) {
      const data = await res.json() as Routine[]
      setRoutines(data)
    }
  }

  useEffect(() => { void loadRoutines() }, [userId])

  const handleToggle = async (routine: Routine) => {
    await fetch(`/api/routines/${routine.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ enabled: !routine.enabled }),
    })
    void loadRoutines()
  }

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--size-heading)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)', marginBottom: 'var(--space-2xl)' }}>
        Routines
      </h1>

      {routines.length === 0 ? (
        <p style={{ fontFamily: 'var(--font-prose)', color: 'var(--color-text-muted)' }}>
          No routines configured.
        </p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Label</th>
              <th>Cron</th>
              <th>Type</th>
              <th>Enabled</th>
            </tr>
          </thead>
          <tbody>
            {routines.map((routine) => (
              <tr key={routine.id}>
                <td style={{ fontFamily: 'var(--font-prose)' }}>{humanReadableCron(routine.cron)}</td>
                <td style={{ fontFamily: 'var(--font-data)' }}>{routine.cron}</td>
                <td style={{ fontFamily: 'var(--font-prose)' }}>{routine.type}</td>
                <td>
                  <button
                    type="button"
                    className="toggle"
                    data-on={String(routine.enabled)}
                    onClick={() => handleToggle(routine)}
                    aria-pressed={routine.enabled}
                  >
                    <span className="toggle-knob" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
