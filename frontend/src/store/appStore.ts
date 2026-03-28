import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

// ---------------------------------------------------------------------------
// HeartbeatEvent — unchanged (used by Dashboard, HeartbeatFeed)
// ---------------------------------------------------------------------------
export interface HeartbeatEvent {
  id: string
  userId: string
  decision: 'interrupt' | 'batch' | 'skip' | 'silent'
  from_phone: string
  body_preview: string
  timestamp: string
}

// ---------------------------------------------------------------------------
// AppStore interface
// ---------------------------------------------------------------------------
interface AppStore {
  // -- Auth state --
  caregiverId: string | null        // Supabase auth.uid() from session
  userId: string | null             // VI user UUID from caregiver_links
  session: Session | null           // Full Supabase session (JWT, expiry)
  isAuthenticated: boolean          // session !== null && userId !== null

  // -- Agent / UI state (unchanged) --
  sessionPhase: string
  heartbeatLog: HeartbeatEvent[]

  // -- Auth methods --
  signIn: (email: string) => Promise<void>
  verifyOtp: (email: string, token: string) => Promise<void>
  linkViUser: (phone: string, name: string, smsOtp: string) => Promise<void>
  signOut: () => Promise<void>
  initAuth: () => Promise<() => void>  // call on app mount; returns cleanup fn

  // -- Agent / UI methods (unchanged) --
  setSessionPhase: (phase: string) => void
  addHeartbeatEvent: (event: HeartbeatEvent) => void
  subscribeToSSE: (token: string) => () => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const apiBase = (): string =>
  (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:3000'

const apiToken = (): string =>
  (import.meta.env.VITE_API_TOKEN as string | undefined) ?? ''

const authHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${apiToken()}`,
})

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
export const useAppStore = create<AppStore>((set, get) => ({
  // -- Initial auth state --
  caregiverId: null,
  userId: null,
  session: null,
  isAuthenticated: false,

  // -- Initial agent/UI state --
  sessionPhase: 'idle',
  heartbeatLog: [],

  // --------------------------------------------------------------------------
  // initAuth — call once on app mount (in App.tsx useEffect)
  // Rehydrates existing session from localStorage via Supabase client.
  // Sets up onAuthStateChange listener to keep session fresh.
  // Returns cleanup function to unsubscribe.
  // --------------------------------------------------------------------------
  initAuth: async () => {
    // Rehydrate existing session
    const { data: { session } } = await supabase.auth.getSession()
    if (session) {
      set({
        session,
        caregiverId: session.user.id,
        // userId is loaded separately via linkViUser or by querying caregiver_links
        // It may already be in localStorage from a previous linkViUser call
        userId: localStorage.getItem('voiceapp_user_id'),
        isAuthenticated: !!localStorage.getItem('voiceapp_user_id'),
      })
    }

    // Listen for auth state changes (sign-in, sign-out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        set({
          session,
          caregiverId: session.user.id,
          userId: localStorage.getItem('voiceapp_user_id'),
          isAuthenticated: !!localStorage.getItem('voiceapp_user_id'),
        })
      } else {
        set({ session: null, caregiverId: null, userId: null, isAuthenticated: false })
        localStorage.removeItem('voiceapp_user_id')
      }
    })

    return () => subscription.unsubscribe()
  },

  // --------------------------------------------------------------------------
  // signIn — Step 1: send magic-link/OTP email to caregiver
  // --------------------------------------------------------------------------
  signIn: async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    })
    if (error) throw new Error(error.message)
  },

  // --------------------------------------------------------------------------
  // verifyOtp — Step 1 completion: verify 6-digit email OTP from Supabase
  // --------------------------------------------------------------------------
  verifyOtp: async (email: string, token: string) => {
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    })
    if (error) throw new Error(error.message)
    if (data.session) {
      set({
        session: data.session,
        caregiverId: data.session.user.id,
        // userId still null — linkViUser sets it in Step 2
      })
    }
  },

  // --------------------------------------------------------------------------
  // linkViUser — Step 2: send 4-digit SMS OTP to VI phone, then verify
  // Calls backend POST /api/auth/send-otp → user enters OTP → POST /api/auth/verify-otp
  // On success: stores userId in localStorage and sets isAuthenticated = true
  // --------------------------------------------------------------------------
  linkViUser: async (phone: string, name: string, smsOtp: string) => {
    const state = get()
    if (!state.caregiverId || !state.session) {
      throw new Error('Caregiver must be authenticated before linking VI user')
    }

    const res = await fetch(`${apiBase()}/api/auth/verify-otp`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        phone,
        otp: smsOtp,
        name,
        caregiverId: state.caregiverId,
        caregiverEmail: state.session.user.email ?? '',
      }),
    })

    const json = await res.json() as { userId?: string; linked?: boolean; error?: string }

    if (!res.ok || !json.userId) {
      throw new Error(json.error ?? 'Failed to link VI user')
    }

    localStorage.setItem('voiceapp_user_id', json.userId)
    set({ userId: json.userId, isAuthenticated: true })
  },

  // --------------------------------------------------------------------------
  // signOut — clears Supabase session and local state
  // --------------------------------------------------------------------------
  signOut: async () => {
    await supabase.auth.signOut()
    localStorage.removeItem('voiceapp_user_id')
    set({ session: null, caregiverId: null, userId: null, isAuthenticated: false })
  },

  // --------------------------------------------------------------------------
  // Agent / UI methods — unchanged
  // --------------------------------------------------------------------------
  setSessionPhase: (phase) => set({ sessionPhase: phase }),
  addHeartbeatEvent: (event) =>
    set((s) => ({ heartbeatLog: [event, ...s.heartbeatLog].slice(0, 100) })),

  subscribeToSSE: (token) => {
    const backendBase = apiBase()
    const heartbeatES = new EventSource(`${backendBase}/api/sse/heartbeat?token=${token}`)
    const agentStateES = new EventSource(`${backendBase}/api/sse/agent-state?token=${token}`)

    heartbeatES.addEventListener('heartbeat', (e) => {
      const event = JSON.parse(e.data) as HeartbeatEvent
      set((s) => ({ heartbeatLog: [event, ...s.heartbeatLog].slice(0, 100) }))
    })
    agentStateES.addEventListener('agent-state', (e) => {
      const { phase } = JSON.parse(e.data) as { phase: string }
      set({ sessionPhase: phase })
    })

    return () => {
      heartbeatES.close()
      agentStateES.close()
    }
  },
}))
