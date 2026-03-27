import { describe, test, expect } from 'bun:test'
import { classifyIntent } from '../src/agent/classifier'

describe('AGENT-02: Fast-path intent classifier — all 8 AGENT-02 intents', () => {
  test('send_message intent', () => {
    expect(classifyIntent('send a message to Naledi')).toBe('send_message')
    expect(classifyIntent('message Bongani')).toBe('send_message')
    expect(classifyIntent('text my wife')).toBe('send_message')
    expect(classifyIntent('whatsapp John')).toBe('send_message')
  })

  test('read_messages intent', () => {
    expect(classifyIntent('read my messages')).toBe('read_messages')
    expect(classifyIntent('read messages')).toBe('read_messages')
    expect(classifyIntent('any new messages')).toBe('read_messages')
    expect(classifyIntent('what messages do I have')).toBe('read_messages')
    expect(classifyIntent('my messages please')).toBe('read_messages')
  })

  test('save_contact intent', () => {
    expect(classifyIntent('save contact')).toBe('save_contact')
    expect(classifyIntent('add contact')).toBe('save_contact')
    expect(classifyIntent('save Naledi as a contact')).toBe('save_contact')
    expect(classifyIntent('add Bongani as a contact')).toBe('save_contact')
  })

  test('set_priority intent', () => {
    expect(classifyIntent('make Naledi a priority')).toBe('set_priority')
    expect(classifyIntent('set Bongani as priority')).toBe('set_priority')
    expect(classifyIntent('priority contact')).toBe('set_priority')
  })

  test('load_shedding intent', () => {
    expect(classifyIntent('load shedding today')).toBe('load_shedding')
    expect(classifyIntent('eskom schedule')).toBe('load_shedding')
    expect(classifyIntent('loadshed')).toBe('load_shedding')
    expect(classifyIntent('power cut today')).toBe('load_shedding')
  })

  test('weather intent', () => {
    expect(classifyIntent('weather today')).toBe('weather')
    expect(classifyIntent('what is the temperature')).toBe('weather')
    expect(classifyIntent('will it rain today')).toBe('weather')
    expect(classifyIntent('weather forecast for Johannesburg')).toBe('weather')
  })

  test('web_search intent', () => {
    expect(classifyIntent('search for news about South Africa')).toBe('web_search')
    expect(classifyIntent('look up the rugby results')).toBe('web_search')
    expect(classifyIntent('google this for me')).toBe('web_search')
    expect(classifyIntent('find out about loadshedding schedule')).toBe('web_search')
  })

  test('message_digest intent', () => {
    expect(classifyIntent('digest')).toBe('message_digest')
    expect(classifyIntent('summary of my messages')).toBe('message_digest')
    expect(classifyIntent('what did I miss')).toBe('message_digest')
    expect(classifyIntent('overnight messages')).toBe('message_digest')
  })
})

describe('AGENT-02: Fast-path classifier — confirm/cancel (approval loop)', () => {
  test('confirm_send intent', () => {
    expect(classifyIntent('yes')).toBe('confirm_send')
    expect(classifyIntent('yep')).toBe('confirm_send')
    expect(classifyIntent('yeah')).toBe('confirm_send')
    expect(classifyIntent('confirm')).toBe('confirm_send')
    expect(classifyIntent('send it')).toBe('confirm_send')
    expect(classifyIntent('go ahead')).toBe('confirm_send')
  })

  test('cancel intent', () => {
    expect(classifyIntent('no')).toBe('cancel')
    expect(classifyIntent('nope')).toBe('cancel')
    expect(classifyIntent('cancel')).toBe('cancel')
    expect(classifyIntent('stop')).toBe('cancel')
    expect(classifyIntent('abort')).toBe('cancel')
    expect(classifyIntent('never mind')).toBe('cancel')
  })
})

describe('AGENT-02: Fast-path classifier — case insensitivity', () => {
  test('all patterns match regardless of case', () => {
    expect(classifyIntent('LOAD SHEDDING TODAY')).toBe('load_shedding')
    expect(classifyIntent('READ MY MESSAGES')).toBe('read_messages')
    expect(classifyIntent('WEATHER TODAY')).toBe('weather')
    expect(classifyIntent('YES')).toBe('confirm_send')
    expect(classifyIntent('NO')).toBe('cancel')
  })
})

describe('AGENT-02: Fast-path classifier — null fallthrough', () => {
  test('unknown transcript returns null (falls through to LLM)', () => {
    expect(classifyIntent('blah blah unintelligible noise')).toBeNull()
    expect(classifyIntent('what is the meaning of life')).toBeNull()
    expect(classifyIntent('hello how are you')).toBeNull()
    expect(classifyIntent('')).toBeNull()
    expect(classifyIntent('   ')).toBeNull()
  })
})
