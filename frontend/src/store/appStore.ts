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
// ChatEntry — persisted across navigation in the global store
// ---------------------------------------------------------------------------
export interface ChatEntry {
  role: 'user' | 'agent'
  text: string
  ts: number
}

// ---------------------------------------------------------------------------
// PendingDraft — staged outbound message awaiting user confirmation
// ---------------------------------------------------------------------------
export interface PendingDraft {
  to: string
  toName?: string
  body: string
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
  authLoading: boolean              // true until initAuth() resolves (prevents auth flash)
  viUserName: string | null         // display name of the linked VI user

  // -- Agent / UI state --
  sessionPhase: string
  composingHint: string
  heartbeatLog: HeartbeatEvent[]
  chatLog: ChatEntry[]              // persists across navigation — cleared on sign-out
  pendingDraft: PendingDraft | null // staged message awaiting confirmation

  // -- Auth methods --
  signIn: (email: string) => Promise<void>
  verifyOtp: (email: string, token: string) => Promise<void>
  linkViUser: (phone: string, name: string) => Promise<void>
  signOut: () => Promise<void>
  initAuth: () => Promise<() => void>  // call on app mount; returns cleanup fn

  // -- Agent / UI methods --
  setSessionPhase: (phase: string) => void
  addHeartbeatEvent: (event: HeartbeatEvent) => void
  addChatEntry: (entry: Omit<ChatEntry, 'ts'>) => void
  setPendingDraft: (draft: PendingDraft | null) => void
  setViUserName: (name: string) => void
  subscribeToSSE: (token: string) => () => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const apiBase = (): string =>
  (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

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
  authLoading: true,

  // -- Initial agent/UI state --
  sessionPhase: 'idle',
  composingHint: '',
  heartbeatLog: [],
  chatLog: [],
  pendingDraft: null,
  viUserName: localStorage.getItem('voiceapp_user_name'),

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
      const userId = localStorage.getItem('voiceapp_user_id')
      set({
        session,
        caregiverId: session.user.id,
        userId,
        isAuthenticated: !!userId,
        authLoading: false,
      })
    } else {
      set({ authLoading: false })
    }

    // Listen for auth state changes (sign-in, sign-out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        const userId = localStorage.getItem('voiceapp_user_id')
        set({
          session,
          caregiverId: session.user.id,
          userId,
          isAuthenticated: !!userId,
        })
      } else {
        set({ session: null, caregiverId: null, userId: null, isAuthenticated: false, chatLog: [] })
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
  // linkViUser — Step 2: register VI user by phone + name (no SMS OTP required)
  // Caregiver is already verified via email OTP; they vouch for the VI user number.
  // Calls POST /api/auth/link-vi-user → creates users + caregiver_links rows.
  // On success: stores userId in localStorage and sets isAuthenticated = true.
  // --------------------------------------------------------------------------
  linkViUser: async (phone: string, name: string) => {
    const state = get()
    if (!state.caregiverId || !state.session) {
      throw new Error('Caregiver must be authenticated before linking VI user')
    }

    const res = await fetch(`${apiBase()}/api/auth/link-vi-user`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        phone,
        name,
        caregiverId: state.caregiverId,
        caregiverEmail: state.session.user.email ?? '',
      }),
    })

    const text = await res.text()
    let json: { userId?: string; linked?: boolean; error?: string } = {}
    try { json = JSON.parse(text) } catch { /* non-JSON response (e.g. 401 from bearer middleware) */ }

    if (!res.ok || !json.userId) {
      throw new Error(json.error ?? `Server error ${res.status}`)
    }

    localStorage.setItem('voiceapp_user_id', json.userId)
    if (name) localStorage.setItem('voiceapp_user_name', name)
    set({ userId: json.userId, viUserName: name || null, isAuthenticated: true })
  },

  // --------------------------------------------------------------------------
  // signOut — clears Supabase session and local state
  // --------------------------------------------------------------------------
  signOut: async () => {
    await supabase.auth.signOut()
    localStorage.removeItem('voiceapp_user_id')
    localStorage.removeItem('voiceapp_user_name')
    set({ session: null, caregiverId: null, userId: null, isAuthenticated: false, chatLog: [], pendingDraft: null, viUserName: null })
  },

  // --------------------------------------------------------------------------
  // Agent / UI methods
  // --------------------------------------------------------------------------
  setSessionPhase: (phase) => set({ sessionPhase: phase }),
  addHeartbeatEvent: (event) =>
    set((s) => ({ heartbeatLog: [event, ...s.heartbeatLog].slice(0, 100) })),
  addChatEntry: (entry) =>
    set((s) => ({ chatLog: [...s.chatLog, { ...entry, ts: Date.now() }].slice(-50) })),
  setPendingDraft: (draft) => set({ pendingDraft: draft }),
  setViUserName: (name) => { localStorage.setItem('voiceapp_user_name', name); set({ viUserName: name }) },

  subscribeToSSE: (token) => {
    const backendBase = apiBase()
    const heartbeatES = new EventSource(`${backendBase}/api/sse/heartbeat?token=${token}`)
    const agentStateES = new EventSource(`${backendBase}/api/sse/agent-state?token=${token}`)

    heartbeatES.addEventListener('heartbeat', (e) => {
      const event = JSON.parse(e.data) as HeartbeatEvent
      set((s) => ({ heartbeatLog: [event, ...s.heartbeatLog].slice(0, 100) }))
    })
    agentStateES.addEventListener('agent-state', (e) => {
      const data = JSON.parse(e.data) as { phase: string; hint?: string }
      set({ sessionPhase: data.phase, ...(data.hint !== undefined ? { composingHint: data.hint } : {}) })
    })

    return () => {
      heartbeatES.close()
      agentStateES.close()
    }
  },
}))
