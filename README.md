# VoiceApp

Voice-native AI companion for visually impaired South African users. Uses WhatsApp Cloud API + Claude claude-sonnet-4-6 + ElevenLabs TTS + Bun/Hono backend.

## Setup

Copy `.env.example` to `.env` and fill in all required values.

```bash
cp .env.example .env
# fill in values, then:
bun install
bun run src/server.ts
```

## Development

```bash
bun dev      # watch mode
bun test     # run test suite
```

This project was built with Bun v1.3.10.
