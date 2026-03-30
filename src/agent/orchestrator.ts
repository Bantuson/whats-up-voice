// src/agent/orchestrator.ts
// AGENT-01, AGENT-02, AGENT-03, AGENT-04: Manual tool-use agentic loop.
// CRITICAL: Import from '@anthropic-ai/sdk' — NOT '@anthropic-ai/claude-agent-sdk'.
// The installed package is @anthropic-ai/sdk v0.80.0. Use client.messages.create() with tools[].
import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages'
import { sanitiseForSpeech } from './sanitiser'
import { toolReadMessages, toolSendMessage, toolResolveContact } from '../tools/whatsapp'
import { toolGetContact, toolSaveContact, toolListContacts, toolSetPriority } from '../tools/contacts'
import { toolGetLoadShedding, toolGetWeather, toolWebSearch } from '../tools/ambient'
import { toolCreateRoutine } from '../tools/routines'
import { recallMemories } from '../memory/recall'
import { generatePodcast, toolPlayPodcast } from '../tools/podcast'
import { activateTranslation, deactivateTranslation, translateUtterance } from '../tools/translation'
import { startNavigation, stopNavigation, describeWaypoint } from '../tools/navigation'
import { getState, type ConversationTurn } from '../session/machine'
import { supabase } from '../db/client'

// Lazy singleton — created on first use so tests can mock '@anthropic-ai/sdk' before first call.
let _anthropic: Anthropic | null = null
function getAnthropic() {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return _anthropic
}
const MAX_TOOL_CALLS = 10

export const ORCHESTRATOR_SYSTEM_PROMPT = `
You are a deeply personal AI voice companion for a visually impaired South African WhatsApp user.
All your responses will be spoken aloud via text-to-speech.
You know this person — use their name when appropriate, recall their preferences, and respond with warmth.

CRITICAL RULES:
1. Never use markdown formatting: no **, no ##, no -, no \`, no bullet points
2. Write all responses as natural spoken sentences, not lists
3. Phone numbers must be spoken digit-by-digit (e.g., "plus 2 7 8 3 1")
4. Ask only one question at a time
5. Keep responses brief — the user cannot see; every extra word costs attention
6. SENDING MESSAGES — MANDATORY TOOL SEQUENCE:
   a. First call ResolveContact to get the phone number (unless you already have it).
   b. Then call SendMessage with the resolved phone and message body.
   c. The SendMessage tool returns a readBack string — speak that string verbatim as your reply.
   d. NEVER describe or announce sending a message without calling SendMessage first.
      Generating "Just to confirm..." text without the tool call breaks the confirmation flow.
7. ROUTINES — when the user asks to set a reminder or schedule something:
   a. Convert the request to a cron expression (e.g. "every morning at 7" → "0 7 * * *")
   b. Call CreateRoutine with a clear label so the user knows what will run.
   c. Confirm back with the schedule in plain English.
`.trim()

export const ALL_TOOLS: Anthropic.Tool[] = [
  {
    name: 'ReadMessages',
    description: "Read the user's recent inbound WhatsApp messages. Returns messages with sender name if in contacts.",
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max messages to return (default 5)' } },
      required: [],
    },
  },
  {
    name: 'SendMessage',
    description: 'Queue an outbound WhatsApp message for approval. Does NOT send immediately — transitions session to awaiting_approval.',
    input_schema: {
      type: 'object',
      properties: {
        toPhone: { type: 'string', description: 'E.164 recipient phone number' },
        toName:  { type: 'string', description: 'Resolved contact name for read-back' },
        body:    { type: 'string', description: 'Message text to send' },
      },
      required: ['toPhone', 'body'],
    },
  },
  {
    name: 'ResolveContact',
    description: 'Resolve a spoken name like "Naledi" or "my wife" to an E.164 phone number via user_contacts.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Name or alias to look up' } },
      required: ['name'],
    },
  },
  {
    name: 'GetContact',
    description: 'Get details for a contact by name.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Contact name to look up' } },
      required: ['name'],
    },
  },
  {
    name: 'SaveContact',
    description: 'Save a new contact with name and phone number to user_contacts.',
    input_schema: {
      type: 'object',
      properties: {
        name:  { type: 'string', description: 'Contact name to save' },
        phone: { type: 'string', description: 'Phone number in any format — will be normalised to E.164' },
      },
      required: ['name', 'phone'],
    },
  },
  {
    name: 'ListContacts',
    description: "List all of the user's saved contacts.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'SetPriority',
    description: 'Set or unset a contact as a priority contact. Priority contacts always trigger an interrupt.',
    input_schema: {
      type: 'object',
      properties: {
        name:     { type: 'string', description: 'Contact name to update' },
        priority: { type: 'boolean', description: 'true to set as priority, false to remove priority' },
      },
      required: ['name', 'priority'],
    },
  },
  {
    name: 'GetLoadShedding',
    description: 'Get current and upcoming load shedding schedule for the user area (Johannesburg default).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'GetWeather',
    description: 'Get current weather and today forecast for Johannesburg.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'WebSearch',
    description: 'Search the web for general information. Use for factual questions not covered by other tools.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search query' } },
      required: ['query'],
    },
  },
  {
    name: 'GeneratePodcast',
    description: 'Generate and deliver a personalised podcast on any topic. Researches the topic via web search, synthesises a 2-5 minute natural-speech script, and streams it to the user via TTS. Use when user asks to hear about a topic, wants a podcast, or wants entertainment on a subject.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'The topic or subject for the podcast' },
        shortVersion: { type: 'boolean', description: 'If true, generate a condensed 60-second version instead of full 2-5 minutes' },
      },
      required: ['topic'],
    },
  },
  {
    name: 'PlayPodcast',
    description: 'Play back a previously generated and saved podcast. Use when the user asks to replay, listen to, or play back a podcast they already heard. Optionally filter by topic keyword. Do NOT use this to generate new content — use GeneratePodcast for that.',
    input_schema: {
      type: 'object',
      properties: {
        topicKeyword: { type: 'string', description: 'Optional topic keyword to find a specific saved podcast. Omit to play the most recent one.' },
      },
      required: [],
    },
  },
  {
    name: 'ActivateTranslation',
    description: 'Start real-time translation mode. All subsequent user speech will be translated to the target language and spoken back. Use when user asks to translate to a specific language.',
    input_schema: {
      type: 'object',
      properties: {
        targetLanguage: { type: 'string', description: 'BCP-47 language code: zu (Zulu), xh (Xhosa), st (Sesotho), af (Afrikaans), en (English), fr (French), etc.' },
      },
      required: ['targetLanguage'],
    },
  },
  {
    name: 'DeactivateTranslation',
    description: 'Stop real-time translation mode and return to normal interaction.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'TranslateUtterance',
    description: 'Translate a specific piece of text to the current translation target language and speak it aloud.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to translate' },
      },
      required: ['text'],
    },
  },
  {
    name: 'StartNavigation',
    description: 'Begin verbose navigation to a destination. Fetches walking route from Google Maps, enriches waypoints with nearby places, and delivers verbal environment descriptions as the user moves. Use when user asks for directions or help getting somewhere.',
    input_schema: {
      type: 'object',
      properties: {
        destination: { type: 'string', description: 'The destination address or place name' },
        originLat: { type: 'number', description: 'Optional starting latitude (from user GPS)' },
        originLng: { type: 'number', description: 'Optional starting longitude (from user GPS)' },
      },
      required: ['destination'],
    },
  },
  {
    name: 'StopNavigation',
    description: 'Stop the current navigation session and return to normal interaction.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'DescribeCurrentWaypoint',
    description: 'Re-describe the current navigation waypoint. Use when user asks "where am I" or "what is around me" during navigation.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'CreateRoutine',
    description: 'Create a scheduled routine or reminder for the user. Use when they ask to set a daily reminder, morning briefing, or any recurring task.',
    input_schema: {
      type: 'object',
      properties: {
        routineType: { type: 'string', description: 'Type: morning_briefing, reminder, evening_digest, or custom' },
        cronExpression: { type: 'string', description: 'Cron expression e.g. "0 7 * * 1-5" for Mon–Fri 7am, "0 9 * * *" for daily 9am' },
        label: { type: 'string', description: 'Plain English label e.g. "Morning briefing at 7am weekdays"' },
      },
      required: ['routineType', 'cronExpression', 'label'],
    },
  },
]

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  userId: string,
  signal: AbortSignal,
): Promise<unknown> {
  switch (name) {
    case 'ReadMessages':
      return toolReadMessages(userId, (input.limit as number) ?? 5)
    case 'SendMessage':
      return toolSendMessage(userId, input.toPhone as string, input.body as string, input.toName as string | undefined)
    case 'ResolveContact':
      return toolResolveContact(userId, input.name as string)
    case 'GetContact':
      return toolGetContact(userId, input.name as string)
    case 'SaveContact':
      return toolSaveContact(userId, input.name as string, input.phone as string)
    case 'ListContacts':
      return toolListContacts(userId)
    case 'SetPriority':
      return toolSetPriority(userId, input.name as string, input.priority as boolean)
    case 'GetLoadShedding':
      return toolGetLoadShedding(signal)
    case 'GetWeather':
      return toolGetWeather(signal)
    case 'WebSearch':
      return toolWebSearch(input.query as string, signal)
    case 'GeneratePodcast':
      return generatePodcast(input.topic as string, userId, (input.shortVersion as boolean) ?? false)
    case 'PlayPodcast':
      return toolPlayPodcast(userId, input.topicKeyword as string | undefined)
    case 'ActivateTranslation':
      return activateTranslation(userId, input.targetLanguage as string)
    case 'DeactivateTranslation':
      return deactivateTranslation(userId)
    case 'TranslateUtterance':
      return translateUtterance(userId, input.text as string)
    case 'StartNavigation':
      return startNavigation(userId, input.destination as string, input.originLat as number | undefined, input.originLng as number | undefined)
    case 'StopNavigation':
      return stopNavigation(userId)
    case 'DescribeCurrentWaypoint': {
      const navState = getState(userId)
      if (!navState.navigationSession) return { error: 'No active navigation session' }
      const wp = navState.navigationSession.waypoints[navState.navigationSession.currentWaypointIndex]
      if (!wp) return { error: 'No current waypoint' }
      const desc = await describeWaypoint(wp.instruction, wp.nearbyPlaces, wp.distanceMetres)
      const { streamSpeech } = await import('../tts/openai-tts')
      await streamSpeech(desc, userId)
      return { description: desc }
    }
    case 'CreateRoutine':
      return toolCreateRoutine(userId, input.routineType as string, input.cronExpression as string, input.label as string)
    default:
      return { error: `Unknown tool: ${name}` }
  }
}

export async function runOrchestrator(
  userId: string,
  transcript: string,
  signal: AbortSignal,
  conversationHistory: ConversationTurn[] = [],
): Promise<string> {
  let systemPrompt = ORCHESTRATOR_SYSTEM_PROMPT

  // Inject user identity and preferences so the agent knows who it's talking to
  try {
    const [userRes, profileRes] = await Promise.allSettled([
      supabase.from('users').select('name, phone').eq('id', userId).single(),
      supabase.from('user_profile').select('language, location').eq('user_id', userId).single(),
    ])
    const user = userRes.status === 'fulfilled' ? userRes.value.data : null
    const profile = profileRes.status === 'fulfilled' ? profileRes.value.data : null
    const lines: string[] = []
    if (user?.name)      lines.push(`Name: ${user.name}`)
    if (user?.phone)     lines.push(`Phone: ${user.phone}`)
    if (profile?.language) lines.push(`Language: ${profile.language}`)
    if (profile?.location) lines.push(`Location: ${profile.location}`)
    if (lines.length > 0) {
      systemPrompt = `${systemPrompt}\n\nUser profile:\n${lines.join('\n')}`
    }
  } catch {
    // Non-fatal — agent still works without profile context
  }

  // MEM-03: Recall top-5 relevant memories and inject into system prompt.
  try {
    const memories = await recallMemories(userId, transcript)
    if (memories.length > 0) {
      const memoryBlock = memories.map((m) => `- ${m.content}`).join('\n')
      systemPrompt = `${systemPrompt}\n\nRelevant memories from past sessions:\n${memoryBlock}`
    }
  } catch {
    // Memory recall failure is non-fatal — continue without context
  }

  // Prepend in-session conversation history so Claude has multi-turn context.
  const messages: MessageParam[] = [
    ...conversationHistory.map((h) => ({ role: h.role, content: h.content } as MessageParam)),
    { role: 'user', content: transcript },
  ]
  let toolCallCount = 0

  // Podcast content captured during tool execution — returned as spoken text so
  // the full script reaches the frontend TTS path instead of Claude's short confirmation.
  let capturedPodcastScript: string | null = null

  while (toolCallCount < MAX_TOOL_CALLS) {
    const response = await getAnthropic().messages.create(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemPrompt,
        tools: ALL_TOOLS,
        messages,
      },
      { signal }
    )

    messages.push({ role: 'assistant', content: response.content })

    if (response.stop_reason === 'end_turn') {
      if (capturedPodcastScript) {
        // Stream the full podcast via WebSocket — avoids browser autoplay expiry on the HTTP path.
        // Fire-and-forget: starts OpenAI TTS async while the brief HTTP confirmation plays first.
        const { streamSpeech } = await import('../tts/openai-tts')
        streamSpeech(capturedPodcastScript, userId).catch((e) => console.error('[Podcast] streamSpeech failed:', e))
        // Return Claude's short "it's ready" confirmation for the HTTP TTS path (plays quickly)
        const textBlock = response.content.find((b) => b.type === 'text') as { type: 'text'; text: string } | undefined
        const raw = textBlock?.text ?? 'Your podcast is ready and now playing.'
        return sanitiseForSpeech(raw)
      }
      const textBlock = response.content.find((b) => b.type === 'text') as { type: 'text'; text: string } | undefined
      const raw = textBlock?.text ?? 'I could not process that request.'
      return sanitiseForSpeech(raw)
    }

    if (response.stop_reason !== 'tool_use') break

    const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = []
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue
      toolCallCount++

      // GeneratePodcast: capture the script and return a brief status to Claude
      // so Claude's response is a short confirmation, not the full 500-word script.
      if (block.name === 'GeneratePodcast') {
        const input = block.input as Record<string, unknown>
        const script = await generatePodcast(input.topic as string, userId, (input.shortVersion as boolean) ?? false)
        capturedPodcastScript = script
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify({ status: 'ready', message: `Podcast about "${input.topic as string}" is ready.` }),
        })
        continue
      }

      const result = await executeTool(block.name, block.input as Record<string, unknown>, userId, signal)
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result),
      })
    }
    messages.push({ role: 'user', content: toolResults })
  }

  return sanitiseForSpeech('I ran into a problem and could not complete that. Please try again.')
}
