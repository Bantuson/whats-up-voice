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
  'REDIS_URL',
  'API_BEARER_TOKEN',
  'ESKOMSEPUSH_API_KEY',
  'OPENWEATHER_API_KEY',
  'TAVILY_API_KEY',
  'SUPABASE_ANON_KEY',
] as const

export function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter(key => !process.env[key])
  if (missing.length > 0) {
    throw new Error(
      `Server cannot start. Missing required environment variables:\n  ${missing.join('\n  ')}`
    )
  }
}
