// src/tools/podcast.ts
// VI-PODCAST-01: Generated podcast tool.
// Flow: Tavily research → Claude synthesis → sanitiseForSpeech → ElevenLabs TTS delivery
// SHORT VERSION: shortVersion=true produces a ~60-second condensed re-synthesis.
import { tavily } from '@tavily/core'
import Anthropic from '@anthropic-ai/sdk'
import { sanitiseForSpeech } from '../agent/sanitiser'
import { streamSpeech } from '../tts/elevenlabs'

// Lazy singletons — same pattern as ambient.ts (Bun mock.module hoisting compatibility)
let _tavilyClient: ReturnType<typeof tavily> | null = null
function getTavily() {
  if (!_tavilyClient) _tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY! })
  return _tavilyClient
}

let _anthropic: Anthropic | null = null
function getAnthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  return _anthropic
}

const PODCAST_SYSTEM_PROMPT = `
You are a radio presenter writing a podcast script for a visually impaired South African listener.
The script will be read aloud by text-to-speech — write ONLY natural spoken sentences.

STRICT RULES:
1. Never use markdown: no **, no ##, no -, no backticks, no bullet points
2. Write as if speaking, not writing — use contractions, short sentences, natural pauses (comma and full stop only)
3. Start with an engaging hook that names the topic
4. Vary sentence length — mix short punchy sentences with longer descriptive ones
5. End with a brief closing line like "And that is today's story on [topic]."
6. Target length: approximately 400-600 words (about 2-3 minutes when read aloud at normal pace)
7. Content must feel like entertainment, not a lecture — think personalised radio, not Wikipedia
`.trim()

const SHORT_VERSION_SYSTEM_PROMPT = `
You are a radio presenter condensing a podcast for a visually impaired South African listener.
The listener has asked for the short version. Produce a single spoken paragraph of about 100-120 words (approximately 60 seconds when read aloud).
Cover only the single most interesting or important point. End with one sentence conclusion.
STRICT RULES: No markdown whatsoever. Natural spoken language only. No lists, no headers.
`.trim()

export async function generatePodcast(
  topic: string,
  userId: string,
  shortVersion = false,
): Promise<string> {
  // Step 1: Research the topic via Tavily (advanced depth for richer content)
  const searchResponse = await getTavily().search(topic, {
    searchDepth: 'advanced',
    maxResults: 5,
    includeAnswer: true,
    topic: 'general',
  })

  const researchContext = searchResponse.answer
    ? `${searchResponse.answer}\n\n${searchResponse.results.map((r: { content: string }) => r.content).join('\n\n')}`
    : searchResponse.results.map((r: { content: string }) => r.content).join('\n\n')

  // Step 2: Synthesise podcast script via Claude
  const systemPrompt = shortVersion ? SHORT_VERSION_SYSTEM_PROMPT : PODCAST_SYSTEM_PROMPT
  const userPrompt = shortVersion
    ? `Condense this research into a 60-second spoken summary about ${topic}:\n\n${researchContext}`
    : `Write an engaging podcast script about "${topic}" using this research:\n\n${researchContext}`

  const response = await getAnthropic().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: shortVersion ? 300 : 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const textBlock = response.content.find((b) => b.type === 'text') as { type: 'text'; text: string } | undefined
  const rawScript = textBlock?.text ?? `I could not generate a podcast about ${topic} right now.`

  // Step 3: Sanitise (strip any accidental markdown) then stream via TTS
  const script = sanitiseForSpeech(rawScript)

  // Deliver via ElevenLabs → WebSocket (non-blocking from caller's perspective)
  await streamSpeech(script, userId)

  return script
}
