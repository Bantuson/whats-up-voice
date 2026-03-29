// src/tools/podcast.ts
// VI-PODCAST-01: Two-host "NotebookLM" style podcast generator.
// Flow: Tavily research → Claude two-host synthesis → sanitiseForSpeech → DB persist
// Audio: parsePodcastSegments + stitchPodcastAudio produces multi-voice MP3 via OpenAI TTS
import { tavily } from '@tavily/core'
import Anthropic from '@anthropic-ai/sdk'
import { sanitiseForSpeech } from '../agent/sanitiser'
import { supabase } from '../db/client'
import { synthesiseSpeechForVoice } from '../tts/openai-tts'

// Lazy singletons
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

// ---------------------------------------------------------------------------
// Segment parser — splits two-host script into [{speaker, text}] array.
// Handles lines like "[THABO]: text" or "[NALEDI]: text".
// ---------------------------------------------------------------------------
export interface PodcastSegment {
  speaker: 'THABO' | 'NALEDI'
  text: string
}

export function parsePodcastSegments(script: string): PodcastSegment[] {
  const segments: PodcastSegment[] = []
  const lines = script.split('\n')
  let current: PodcastSegment | null = null

  for (const line of lines) {
    const thaboMatch = line.match(/^\[THABO\]:\s*(.+)/)
    const nalediMatch = line.match(/^\[NALEDI\]:\s*(.+)/)
    if (thaboMatch) {
      if (current) segments.push(current)
      current = { speaker: 'THABO', text: thaboMatch[1].trim() }
    } else if (nalediMatch) {
      if (current) segments.push(current)
      current = { speaker: 'NALEDI', text: nalediMatch[1].trim() }
    } else if (current && line.trim()) {
      // Continuation of current speaker's turn
      current.text += ' ' + line.trim()
    }
  }
  if (current) segments.push(current)

  // If no markers found, treat entire script as a single NALEDI segment
  if (segments.length === 0 && script.trim()) {
    segments.push({ speaker: 'NALEDI', text: script.trim() })
  }
  return segments
}

// stitchPodcastAudio — synthesises each segment with the appropriate OpenAI voice
// (THABO=onyx, NALEDI=nova by default) and concatenates raw MP3 frames.
export async function stitchPodcastAudio(segments: PodcastSegment[]): Promise<Buffer> {
  const buffers: Buffer[] = []
  for (const seg of segments) {
    if (!seg.text.trim()) continue
    // Pass the speaker label directly — openai-tts maps THABO→onyx, NALEDI→nova
    const buf = await synthesiseSpeechForVoice(seg.text, seg.speaker, 'en')
    buffers.push(buf)
  }
  return Buffer.concat(buffers)
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------
const PODCAST_SYSTEM_PROMPT = `
You are writing a two-host podcast script in the style of Google NotebookLM for a visually impaired South African listener.
The podcast has two hosts:
  - THABO: the curious, enthusiastic host who asks questions, reacts with genuine surprise, and makes relatable analogies.
  - NALEDI: the knowledgeable expert who explains clearly, tells stories, and brings depth.

FORMAT (mandatory — no exceptions):
  [THABO]: text of Thabo's turn
  [NALEDI]: text of Naledi's turn
  [THABO]: ...
  (and so on, alternating, 5-8 exchanges)

STRICT RULES:
1. Start with THABO asking an engaging hook question about the topic
2. Natural spoken language only — contractions, natural pauses (comma and full stop only)
3. No markdown: no **, no ##, no -, no backticks, no bullet points
4. Each turn should be 2-4 sentences — short enough to feel like conversation
5. NALEDI ends the last turn with a brief "And that's the story on [topic]" closing line
6. Total target: 400-600 words across all turns
7. Make it feel like entertainment, not a lecture — think personalised radio
`.trim()

const SHORT_VERSION_SYSTEM_PROMPT = `
You are condensing a podcast into a single 60-second spoken summary for a visually impaired South African listener.
Write one spoken paragraph of about 100-120 words. Cover the single most important point. End with a one-sentence conclusion.
STRICT RULES: No markdown. Natural spoken language only. No host markers ([THABO]/[NALEDI]). Single paragraph.
`.trim()

// ---------------------------------------------------------------------------
// generatePodcast — main entry point
// Returns the raw two-host script (with [THABO]/[NALEDI] markers).
// Audio stitching happens in /api/podcasts/:id/audio (lazy, on first play).
// ---------------------------------------------------------------------------
export async function generatePodcast(
  topic: string,
  userId: string,
  shortVersion = false,
): Promise<string> {
  // Step 1: Research via Tavily
  const searchResponse = await getTavily().search(topic, {
    searchDepth: 'advanced',
    maxResults: 5,
    includeAnswer: true,
    topic: 'general',
  })

  const researchContext = searchResponse.answer
    ? `${searchResponse.answer}\n\n${searchResponse.results.map((r: { content: string }) => r.content).join('\n\n')}`
    : searchResponse.results.map((r: { content: string }) => r.content).join('\n\n')

  // Step 2: Synthesise script via Claude
  const systemPrompt = shortVersion ? SHORT_VERSION_SYSTEM_PROMPT : PODCAST_SYSTEM_PROMPT
  const userPrompt = shortVersion
    ? `Condense this research into a 60-second spoken summary about ${topic}:\n\n${researchContext}`
    : `Write a two-host podcast about "${topic}" using this research:\n\n${researchContext}`

  const response = await getAnthropic().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: shortVersion ? 400 : 1500,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const textBlock = response.content.find((b) => b.type === 'text') as { type: 'text'; text: string } | undefined
  const rawScript = textBlock?.text ?? `I could not generate a podcast about ${topic} right now.`

  // Step 3: Sanitise (strip accidental markdown from non-marker content)
  const script = sanitiseForSpeech(rawScript)

  // Step 4: Persist to DB — fire-and-forget
  supabase
    .from('generated_podcasts')
    .insert({ user_id: userId, topic, script })
    .then(({ error }) => { if (error) console.error('[Podcast] DB insert failed:', error.message) })

  return script
}

// scriptToPlainText — strips [THABO]/[NALEDI] markers for single-voice TTS playback
// (used when agent reads back a podcast summary via voice command).
export function scriptToPlainText(script: string): string {
  return script
    .split('\n')
    .map((line) => line.replace(/^\[(THABO|NALEDI)\]:\s*/, ''))
    .filter(Boolean)
    .join(' ')
}
