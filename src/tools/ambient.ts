// src/tools/ambient.ts
// AGENT-06: Ambient sub-agent handlers — EskomSePush, OpenWeather, Tavily web search.
// All handlers accept an AbortSignal for timeout — orchestrator sets the 5-second deadline.
// AbortSignal.timeout(5000) is NOT set here; it is the caller's responsibility.
import { tavily } from '@tavily/core'

// Lazy singleton — created on first use so tests can override TAVILY_API_KEY via env.
// The mock.module('@tavily/core') in tests replaces the tavily factory before first call.
let _tavilyClient: ReturnType<typeof tavily> | null = null
function getClient() {
  if (!_tavilyClient) {
    _tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY! })
  }
  return _tavilyClient
}

interface EskomAreaResponse {
  events?: Array<{ note: string; start: string; end: string }>
  schedule?: { days: Array<{ date: string; stages: string[][] }> }
}

interface OpenWeatherResponse {
  main: { temp: number; temp_min: number; temp_max: number }
  weather: Array<{ description: string }>
}

export async function toolGetLoadShedding(signal: AbortSignal): Promise<string> {
  const apiKey = process.env.ESKOMSEPUSH_API_KEY
  const areaId = process.env.ESKOMSEPUSH_AREA_ID ?? 'eskde-10-fourwaysext10cityofjohannesburggauteng'

  // Try EskomSePush first (precise, structured data)
  if (apiKey) {
    try {
      const res = await fetch(
        `https://developer.sepush.co.za/business/2.0/area?id=${encodeURIComponent(areaId)}`,
        { headers: { Token: apiKey }, signal }
      )
      if (res.ok) {
        const data = await res.json() as EskomAreaResponse
        if (!data.events || data.events.length === 0) {
          return 'There is no load shedding scheduled in your area right now.'
        }
        const next = data.events[0]
        return `Load shedding is scheduled in your area from ${next.start} to ${next.end}.`
      }
    } catch {
      // fall through to web search
    }
  }

  // Fallback: Tavily web search (works without EskomSePush key, handles rate limits)
  try {
    const result = await getClient().search('Johannesburg load shedding schedule today stage', {
      searchDepth: 'basic',
      maxResults: 2,
      includeAnswer: true,
      topic: 'general',
    })
    const answer = result.answer ?? result.results.map((r: { content: string }) => r.content).slice(0, 1).join(' ')
    return answer ? `Based on online sources: ${answer}` : 'I could not fetch load shedding information right now.'
  } catch {
    return 'I could not fetch load shedding information right now.'
  }
}

export async function toolGetWeather(signal: AbortSignal): Promise<string> {
  const lat = -26.2041
  const lon = 28.0473
  try {
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${process.env.OPENWEATHER_API_KEY!}`,
      { signal }
    )
    if (!res.ok) return 'I could not fetch the weather right now.'
    const data = await res.json() as OpenWeatherResponse
    const temp = Math.round(data.main.temp)
    const desc = data.weather[0].description
    const high = Math.round(data.main.temp_max)
    const low  = Math.round(data.main.temp_min)
    return `It is currently ${temp}°C with ${desc}. Today's high is ${high}°C and the low is ${low}°C.`
  } catch {
    return 'I could not fetch the weather right now.'
  }
}

export async function toolWebSearch(query: string, _signal: AbortSignal): Promise<string> {
  try {
    const response = await getClient().search(query, {
      searchDepth: 'basic',
      maxResults: 3,
      includeAnswer: true,
      topic: 'general',
    })
    return response.answer ?? response.results.map((r: { content: string }) => r.content).join(' ')
  } catch {
    return 'I could not find information on that right now.'
  }
}
