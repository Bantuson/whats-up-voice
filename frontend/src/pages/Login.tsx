// Login.tsx — legacy page, replaced by Auth.tsx in Phase 06 Plan 03.
// This stub exists only to keep TypeScript build passing until Plan 03 replaces it.
import { useNavigate } from 'react-router-dom'
import { useEffect } from 'react'

export function Login() {
  const navigate = useNavigate()

  useEffect(() => {
    navigate('/auth', { replace: true })
  }, [navigate])

  return null
}
