// src/agent/sanitiser.ts
// AGENT-07, AGENT-08: Strip markdown at TTS output boundary.
// Applied unconditionally on EVERY code path that returns a spoken string.
// Two-layer defence: system prompt instructs no markdown + this post-processor catches any slip.

const MD_PATTERNS: Array<[RegExp, string | ((m: string, p1?: string) => string)]> = [
  [/\*{1,3}([^*]+)\*{1,3}/g, (_m, p1) => p1 ?? ''],  // **bold**, *italic*, ***both***
  [/#{1,6}\s/g, ''],                                    // ## headers
  [/^[-*+]\s/gm, ''],                                   // - bullet at line start
  [/`{1,3}[^`]*`{1,3}/g, ''],                          // `code` and ```blocks```
  [/\[([^\]]+)\]\([^)]+\)/g, (_m, p1) => p1 ?? ''],   // [link](url) → link text
  [/^\s*>\s/gm, ''],                                    // > blockquote
]

export function sanitiseForSpeech(text: string): string {
  let out = text
  for (const [pattern, replacement] of MD_PATTERNS) {
    out = out.replace(pattern as RegExp, replacement as string)
  }
  return out.replace(/\n{2,}/g, ' ').trim()
}
