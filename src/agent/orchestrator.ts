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
import { recallMemories } from '../memory/recall'

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
You are a voice assistant for a visually impaired South African WhatsApp user.
All your responses will be spoken aloud via text-to-speech.

CRITICAL RULES:
1. Never use markdown formatting: no **, no ##, no -, no \`, no bullet points
2. Write all responses as natural spoken sentences, not lists
3. Phone numbers must be spoken digit-by-digit (e.g., "plus 2 7 8 3 1")
4. Ask only one question at a time
5. Keep responses brief — the user cannot see; every extra word costs attention
6. When composing a message, always read back the recipient name and message for confirmation
7. All database queries are already filtered by the current user — do not ask for user identity
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
    default:
      return { error: `Unknown tool: ${name}` }
  }
}

export async function runOrchestrator(
  userId: string,
  transcript: string,
  signal: AbortSignal,
): Promise<string> {
  // MEM-03: Recall top-5 relevant memories and inject into system prompt.
  let systemPrompt = ORCHESTRATOR_SYSTEM_PROMPT
  try {
    const memories = await recallMemories(userId, transcript)
    if (memories.length > 0) {
      const memoryBlock = memories.map((m) => `- ${m.content}`).join('\n')
      systemPrompt = `${ORCHESTRATOR_SYSTEM_PROMPT}\n\nRelevant memories from past sessions:\n${memoryBlock}`
    }
  } catch {
    // Memory recall failure is non-fatal — continue without context
  }

  const messages: MessageParam[] = [{ role: 'user', content: transcript }]
  let toolCallCount = 0

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
      const textBlock = response.content.find((b) => b.type === 'text') as { type: 'text'; text: string } | undefined
      const raw = textBlock?.text ?? 'I could not process that request.'
      return sanitiseForSpeech(raw)
    }

    if (response.stop_reason !== 'tool_use') break

    const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = []
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue
      toolCallCount++
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
