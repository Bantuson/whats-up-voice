// tests/setup.ts
// Preload file for bun test — sets required env vars so modules that call
// createClient() at import time don't crash in the test environment.
// The actual supabase client is mocked per-test via mock.module().

process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'test-service-role-key'
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'test-anthropic-key'
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'test-openai-key'
process.env.ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY ?? 'test-elevenlabs-key'
process.env.ELEVENLABS_VOICE_ID_EN = process.env.ELEVENLABS_VOICE_ID_EN ?? 'test-voice-id-en'
process.env.ELEVENLABS_VOICE_ID_AF = process.env.ELEVENLABS_VOICE_ID_AF ?? 'test-voice-id-af'
process.env.WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID ?? 'test-phone-number-id'
process.env.WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN ?? 'test-access-token'
process.env.WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET ?? 'test-app-secret'
process.env.WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN ?? 'test-verify-token'
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'
process.env.API_BEARER_TOKEN = process.env.API_BEARER_TOKEN ?? 'test-bearer-token'
process.env.TAVILY_API_KEY = process.env.TAVILY_API_KEY ?? 'test-tavily-key'
process.env.ESKOMSEPUSH_API_KEY = process.env.ESKOMSEPUSH_API_KEY ?? 'test-eskom-key'
process.env.OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY ?? 'test-openweather-key'
