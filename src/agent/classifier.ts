// src/agent/classifier.ts
// Fast-path intent classifier — evaluated BEFORE any LLM invocation.
// Returns an intent string in < 1ms for the 10 covered patterns.
// Returns null for unknown transcripts — caller routes to Claude orchestrator.
//
// Pattern evaluation order matters:
//   1. confirm_send / cancel — short utterances, must be checked first to avoid
//      "yes" matching a later broader pattern
//   2. message_digest — checked before send/read to avoid "what did I miss" hitting send_message
//   3. send_message — before read_messages (avoids "send me my messages" misfiring)
//   4. read_messages, save_contact, set_priority, ambient (load_shedding, weather, web_search)
//
// AGENT-02 requires 8 intents; classifier also covers confirm_send + cancel (approval loop)
// Target: < 1ms per call (pure regex, no I/O, no await)

export type FastPathIntent =
  | 'confirm_send'
  | 'cancel'
  | 'send_message'
  | 'read_messages'
  | 'save_contact'
  | 'set_priority'
  | 'load_shedding'
  | 'weather'
  | 'web_search'
  | 'message_digest'
  | 'podcast_request'
  | 'short_version'
  | 'start_translation'
  | 'stop_translation'
  | 'start_navigation'
  | 'stop_navigation'

const FAST_PATH: Array<[RegExp, FastPathIntent]> = [
  // Confirmation loop — checked first (short utterances, no ambiguity)
  [/^(yes|yep|yeah|confirm|send it|go ahead|do it)\.?$/i, 'confirm_send'],
  [/^(no|nope|cancel|stop|don't send|abort|never mind)\.?$/i, 'cancel'],
  // Message digest — before send/read to avoid overlap
  [/digest|summary|what did i miss|overnight messages?/i, 'message_digest'],
  // Send message — before read (avoids "send me my messages" firing read_messages)
  [/send (a )?message to|message |text |whatsapp /i, 'send_message'],
  // Read messages
  [/read (my |new )?messages?|any new messages?|what messages?|my messages?/i, 'read_messages'],
  // Contact management
  [/save (a )?contact|add (a )?contact|save .+ as (a )?contact|add .+ as (a )?contact/i, 'save_contact'],
  [/make .+ (a )?priority|set .+ as priority|priority contact/i, 'set_priority'],
  // Navigation control — before translation/search to avoid "help me get to X" matching other patterns
  [/help me (get|go) to|navigate to|take me to|directions? to|how do i get to|find my way to/i, 'start_navigation'],
  [/stop navigation|cancel navigation|end navigation|stop (guiding|directions)|i'?m here|i have arrived/i, 'stop_navigation'],
  // Translation session control — before search/podcast so "start translating" doesn't match other patterns
  [/start translat|translat(e|ing) (to|into)|speak (in|to) (zulu|xhosa|sotho|sesotho|afrikaans|french|portuguese|swahili|english)|i need (to translate|translation)/i, 'start_translation'],
  [/stop translat|end translat|exit translat|no more translat|stop interpreting/i, 'stop_translation'],
  // Explicit search requests — before ambient queries to avoid load/weather keywords hijacking "find out about X"
  [/search for|look up|google|find out/i, 'web_search'],
  // Ambient queries
  [/load.?shed|eskom|power cut|power outage|loadshed/i, 'load_shedding'],
  [/weather|temperature|rain|forecast|hot today|cold today|how warm|how cold/i, 'weather'],
  // Podcast requests — after ambient queries so weather/load_shedding take precedence
  [/tell me (something |a story |more )?(about|on)|make (me )?a podcast|i want to hear about|podcast about|tell me about/i, 'podcast_request'],
  // Short version request — checked after confirm/cancel so "no" doesn't accidentally hit
  [/short version|give me the short|summarise that|summarize that|shorter version/i, 'short_version'],
]

/**
 * Classify a voice transcript to a fast-path intent.
 * @returns intent string if a pattern matches, or null to fall through to LLM
 */
export function classifyIntent(transcript: string): FastPathIntent | null {
  const t = transcript.trim()
  for (const [pattern, intent] of FAST_PATH) {
    if (pattern.test(t)) return intent
  }
  return null
}
