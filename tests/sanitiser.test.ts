// tests/sanitiser.test.ts
// Unit tests for sanitiseForSpeech() — markdown stripping for TTS output.
// AGENT-07, AGENT-08: ensures Claude output never contains markdown chars when spoken.
import { describe, expect, test } from 'bun:test'
import { sanitiseForSpeech } from '../src/agent/sanitiser'

describe('sanitiseForSpeech', () => {
  test('strips double-asterisk bold wrapping', () => {
    expect(sanitiseForSpeech('**bold text**')).toBe('bold text')
  })

  test('strips single-asterisk italic wrapping', () => {
    expect(sanitiseForSpeech('*italic*')).toBe('italic')
  })

  test('strips triple-asterisk bold-italic wrapping', () => {
    expect(sanitiseForSpeech('***bold italic***')).toBe('bold italic')
  })

  test('strips ## header prefix', () => {
    expect(sanitiseForSpeech('## Header')).toBe('Header')
  })

  test('strips # header prefix', () => {
    expect(sanitiseForSpeech('# Main Title')).toBe('Main Title')
  })

  test('strips dash-space bullet at line start', () => {
    expect(sanitiseForSpeech('- bullet item')).toBe('bullet item')
  })

  test('strips asterisk-space bullet at line start', () => {
    expect(sanitiseForSpeech('* bullet item')).toBe('bullet item')
  })

  test('strips inline code backticks (keeps content removed)', () => {
    const result = sanitiseForSpeech('`code`')
    // backtick-wrapped content is stripped entirely
    expect(result).toBe('')
  })

  test('strips code block backticks', () => {
    const result = sanitiseForSpeech('```block```')
    expect(result).toBe('')
  })

  test('strips URL and keeps link display text', () => {
    expect(sanitiseForSpeech('[link text](https://example.com)')).toBe('link text')
  })

  test('strips blockquote prefix', () => {
    expect(sanitiseForSpeech('> blockquote')).toBe('blockquote')
  })

  test('collapses double newlines to single space', () => {
    expect(sanitiseForSpeech('line1\n\nline2')).toBe('line1 line2')
  })

  test('plain text passes through unchanged', () => {
    expect(sanitiseForSpeech('plain text')).toBe('plain text')
  })

  test('empty string returns empty string', () => {
    expect(sanitiseForSpeech('')).toBe('')
  })

  test('whitespace-only string trims to empty string', () => {
    expect(sanitiseForSpeech('   ')).toBe('')
  })

  test('strips mixed markdown in a single string', () => {
    const input = '**Hello** from *Mzansi*. Check [here](https://example.com).'
    const result = sanitiseForSpeech(input)
    expect(result).not.toContain('**')
    expect(result).not.toContain('*')
    expect(result).not.toContain('https://example.com')
    expect(result).toContain('Hello')
    expect(result).toContain('Mzansi')
    expect(result).toContain('here')
  })

  test('handles multiple bullet lines', () => {
    const input = '- item one\n- item two\n- item three'
    const result = sanitiseForSpeech(input)
    expect(result).not.toContain('- ')
    expect(result).toContain('item one')
    expect(result).toContain('item two')
    expect(result).toContain('item three')
  })
})
