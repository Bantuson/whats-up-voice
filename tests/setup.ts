// tests/setup.ts
// Preload file for bun test — sets required env vars so modules that call
// createClient() at import time don't crash in the test environment.
// The actual supabase client is mocked per-test via mock.module().

process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'test-service-role-key'
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'test-anthropic-key'
process.env.TAVILY_API_KEY = process.env.TAVILY_API_KEY ?? 'test-tavily-key'
process.env.ESKOMSEPUSH_API_KEY = process.env.ESKOMSEPUSH_API_KEY ?? 'test-eskom-key'
process.env.OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY ?? 'test-openweather-key'
