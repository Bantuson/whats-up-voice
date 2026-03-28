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
  current: { temp: number; weather: Array<{ description: string }> }
  daily: Array<{ temp: { max: number; min: number } }>
}

export async function toolGetLoadShedding(signal: AbortSignal): Promise<string> {
  const areaId = process.env.ESKOMSEPUSH_AREA_ID ?? 'eskde-10-fourwaysext10cityofjohannesburggauteng'
  try {
    const res = await fetch(
      `https://developer.sepush.co.za/business/2.0/area?id=${encodeURIComponent(areaId)}`,
      { headers: { Token: process.env.ESKOMSEPUSH_API_KEY! }, signal }
    )
    if (!res.ok) return 'I could not fetch load shedding information right now.'
    const data = await res.json() as EskomAreaResponse
    if (!data.events || data.events.length === 0) {
      return 'There is no load shedding scheduled in your area right now.'
    }
    const next = data.events[0]
    return `Load shedding is scheduled in your area from ${next.start} to ${next.end}.`
  } catch {
    return 'I could not fetch load shedding information right now.'
  }
}

export async function toolGetWeather(signal: AbortSignal): Promise<string> {
  const lat = -26.2041
  const lon = 28.0473
  try {
    const res = await fetch(
      `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&exclude=minutely,hourly,alerts&appid=${process.env.OPENWEATHER_API_KEY!}`,
      { signal }
    )
    if (!res.ok) return 'I could not fetch the weather right now.'
    const data = await res.json() as OpenWeatherResponse
    const temp = Math.round(data.current.temp)
    const desc = data.current.weather[0].description
    const high = Math.round(data.daily[0].temp.max)
    const low  = Math.round(data.daily[0].temp.min)
    return `It is currently ${temp} degrees with ${desc}. Today's high is ${high} and the low is ${low}.`
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
