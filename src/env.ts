// src/env.ts
// Called synchronously before Bun.serve() to fail fast on missing config.
// Missing vars throw immediately — never defer to first use.

const REQUIRED_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_WHATSAPP_NUMBER',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'API_BEARER_TOKEN',
  'TAVILY_API_KEY',
  // REDIS_URL optional — server boots without it (BullMQ heartbeat/cron disabled)
  // ESKOMSEPUSH_API_KEY optional — load shedding falls back to Tavily web search
  // OPENWEATHER_API_KEY optional — weather shows as unavailable if missing
] as const

export function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter(key => !process.env[key])
  if (missing.length > 0) {
    throw new Error(
      `Server cannot start. Missing required environment variables:\n  ${missing.join('\n  ')}`
    )
  }
}
