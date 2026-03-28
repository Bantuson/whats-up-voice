import { create } from 'zustand'

export interface HeartbeatEvent {
  id: string
  userId: string
  decision: 'interrupt' | 'batch' | 'skip' | 'silent'
  from_phone: string
  body_preview: string
  timestamp: string
}

interface AppStore {
  userId: string | null
  sessionPhase: string
  heartbeatLog: HeartbeatEvent[]
  setUserId: (id: string) => void
  setSessionPhase: (phase: string) => void
  addHeartbeatEvent: (event: HeartbeatEvent) => void
  subscribeToSSE: (token: string) => () => void
}

export const useAppStore = create<AppStore>((set) => ({
  userId: localStorage.getItem('voiceapp_user_id'),
  sessionPhase: 'idle',
  heartbeatLog: [],
  setUserId: (id) => {
    localStorage.setItem('voiceapp_user_id', id)
    set({ userId: id })
  },
  setSessionPhase: (phase) => set({ sessionPhase: phase }),
  addHeartbeatEvent: (event) =>
    set((s) => ({ heartbeatLog: [event, ...s.heartbeatLog].slice(0, 100) })),
  subscribeToSSE: (token) => {
    const backendBase = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000'
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
