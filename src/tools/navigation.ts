// src/tools/navigation.ts
// VI-NAV-01, VI-NAV-02, VI-NAV-03: Verbose Navigation tool.
// Flow: startNavigation(destination) → Google Maps Directions + Places API →
//       Claude generates verbal waypoint descriptions → streamSpeech delivers sequentially.
// Location updates: updateLocation(lat, lng) → advance to next waypoint when close enough.
// Interruptible: stopNavigation() resets session to idle.
import Anthropic from '@anthropic-ai/sdk'
import { transition, getState, setNavigationSession, clearNavigationSession } from '../session/machine'
import { streamSpeech } from '../tts/elevenlabs'
import { sanitiseForSpeech } from '../agent/sanitiser'

const GOOGLE_MAPS_API_KEY = () => process.env.GOOGLE_MAPS_API_KEY!

// Proximity threshold: consider waypoint reached if within 50 metres
const WAYPOINT_REACH_METRES = 50

// Lazy Anthropic singleton
let _anthropic: Anthropic | null = null
function getAnthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  return _anthropic
}

// ---- Google Maps helpers ----

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

interface DirectionsStep {
  html_instructions: string
  distance: { value: number }
  start_location: { lat: number; lng: number }
  end_location: { lat: number; lng: number }
  maneuver?: string
}

interface DirectionsResponse {
  routes: Array<{ legs: Array<{ steps: DirectionsStep[] }> }>
  status: string
}

interface PlacesNearbyResponse {
  results: Array<{ name: string; types: string[] }>
  status: string
}

async function fetchDirections(origin: string, destination: string): Promise<DirectionsStep[]> {
  const url = new URL('https://maps.googleapis.com/maps/api/directions/json')
  url.searchParams.set('origin', origin)
  url.searchParams.set('destination', destination)
  url.searchParams.set('mode', 'walking')
  url.searchParams.set('key', GOOGLE_MAPS_API_KEY())

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`Directions API error: ${res.status}`)
  const data = await res.json() as DirectionsResponse
  if (data.status !== 'OK') throw new Error(`Directions API status: ${data.status}`)
  return data.routes[0]?.legs[0]?.steps ?? []
}

async function fetchNearbyPlaces(lat: number, lng: number): Promise<string[]> {
  const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json')
  url.searchParams.set('location', `${lat},${lng}`)
  url.searchParams.set('radius', '80')   // 80 metre radius
  url.searchParams.set('key', GOOGLE_MAPS_API_KEY())

  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return []
    const data = await res.json() as PlacesNearbyResponse
    return data.results.slice(0, 3).map((p) => p.name)
  } catch {
    return []
  }
}

// ---- Claude verbal description generator ----

export async function describeWaypoint(
  instruction: string,
  nearbyPlaces: string[],
  distanceMetres: number,
): Promise<string> {
  const placesContext = nearbyPlaces.length > 0
    ? `Nearby places at this point: ${nearbyPlaces.join(', ')}.`
    : 'No notable places identified nearby.'

  const response = await getAnthropic().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    system: `You are narrating the environment for a visually impaired pedestrian.
Convert navigation instructions into rich verbal environment descriptions.
Rules:
1. Lead with the environment and feel of the space — what it sounds, smells, or feels like if known
2. Mention nearby places and landmarks by name
3. Give direction instruction AFTER the environment description
4. Speak naturally as if guiding a friend — short sentences, no markdown
5. Never use street abbreviations like St or Rd — say Street and Road
6. One paragraph only. Maximum 3 sentences.`,
    messages: [{
      role: 'user',
      content: `Navigation step: ${stripHtml(instruction)} (${distanceMetres} metres)\n${placesContext}\nDescribe this waypoint for a visually impaired pedestrian.`,
    }],
  })

  const textBlock = response.content.find((b) => b.type === 'text') as { type: 'text'; text: string } | undefined
  return sanitiseForSpeech(textBlock?.text ?? stripHtml(instruction))
}

// ---- Public tool functions ----

export interface NavigationStartResult {
  started: boolean
  destination: string
  waypointCount: number
  firstDescription: string
}

export interface NavigationSession {
  destination: string
  waypoints: Array<{
    stepIndex: number
    instruction: string
    startLat: number
    startLng: number
    endLat: number
    endLng: number
    distanceMetres: number
    nearbyPlaces: string[]
  }>
  currentWaypointIndex: number
  origin?: { lat: number; lng: number }
}

export async function startNavigation(
  userId: string,
  destination: string,
  originLat?: number,
  originLng?: number,
): Promise<NavigationStartResult> {
  // Use provided origin or default to Johannesburg city centre as fallback
  const originStr = (originLat && originLng)
    ? `${originLat},${originLng}`
    : '-26.2041,28.0473'

  const steps = await fetchDirections(originStr, destination)

  if (steps.length === 0) {
    return { started: false, destination, waypointCount: 0, firstDescription: `I could not find a walking route to ${destination}.` }
  }

  // Enrich each step with nearby places (parallel fetches, limited to first 5 steps for latency)
  const stepsToEnrich = steps.slice(0, 5)
  const enrichedWaypoints = await Promise.all(
    stepsToEnrich.map(async (step) => {
      const nearbyPlaces = await fetchNearbyPlaces(step.start_location.lat, step.start_location.lng)
      return {
        stepIndex: steps.indexOf(step),
        instruction: stripHtml(step.html_instructions),
        startLat: step.start_location.lat,
        startLng: step.start_location.lng,
        endLat: step.end_location.lat,
        endLng: step.end_location.lng,
        distanceMetres: step.distance.value,
        nearbyPlaces,
      }
    })
  )

  // Transition session to navigating
  try {
    transition(userId, 'navigating')
  } catch {
    transition(userId, 'idle')
    transition(userId, 'navigating')
  }

  setNavigationSession(userId, {
    destination,
    waypoints: enrichedWaypoints,
    currentWaypointIndex: 0,
    origin: originLat && originLng ? { lat: originLat, lng: originLng } : undefined,
  })

  // Generate first waypoint description
  const firstWaypoint = enrichedWaypoints[0]
  const firstDescription = await describeWaypoint(
    firstWaypoint.instruction,
    firstWaypoint.nearbyPlaces,
    firstWaypoint.distanceMetres,
  )

  // Deliver via TTS
  const fullSpoken = sanitiseForSpeech(
    `Starting navigation to ${destination}. ${firstDescription} I will guide you step by step as you move.`
  )
  await streamSpeech(fullSpoken, userId)

  return {
    started: true,
    destination,
    waypointCount: enrichedWaypoints.length,
    firstDescription: fullSpoken,
  }
}

export async function updateLocation(
  userId: string,
  lat: number,
  lng: number,
): Promise<{ advanced: boolean; waypointDescription: string | null; completed: boolean }> {
  const state = getState(userId)
  if (!state.navigationSession || state.phase !== 'navigating') {
    return { advanced: false, waypointDescription: null, completed: false }
  }

  const { waypoints, currentWaypointIndex, destination } = state.navigationSession
  const currentWaypoint = waypoints[currentWaypointIndex]

  if (!currentWaypoint) {
    // All waypoints completed
    await stopNavigation(userId)
    const completionMsg = sanitiseForSpeech(`You have arrived at ${destination}.`)
    await streamSpeech(completionMsg, userId)
    return { advanced: true, waypointDescription: completionMsg, completed: true }
  }

  // Check if user is close enough to current waypoint end point
  const distToEnd = haversineMetres(lat, lng, currentWaypoint.endLat, currentWaypoint.endLng)

  if (distToEnd > WAYPOINT_REACH_METRES) {
    // Not yet at waypoint — re-read current description as reminder
    const reminder = await describeWaypoint(
      currentWaypoint.instruction,
      currentWaypoint.nearbyPlaces,
      Math.round(distToEnd),
    )
    await streamSpeech(reminder, userId)
    return { advanced: false, waypointDescription: reminder, completed: false }
  }

  // Advance to next waypoint
  const nextIndex = currentWaypointIndex + 1

  if (nextIndex >= waypoints.length) {
    // Final waypoint reached
    await stopNavigation(userId)
    const completionMsg = sanitiseForSpeech(`You have arrived at your destination, ${destination}. Navigation complete.`)
    await streamSpeech(completionMsg, userId)
    return { advanced: true, waypointDescription: completionMsg, completed: true }
  }

  // Update navigation session index
  setNavigationSession(userId, { ...state.navigationSession, currentWaypointIndex: nextIndex })

  const nextWaypoint = waypoints[nextIndex]
  const nextDescription = await describeWaypoint(
    nextWaypoint.instruction,
    nextWaypoint.nearbyPlaces,
    nextWaypoint.distanceMetres,
  )
  await streamSpeech(nextDescription, userId)
  return { advanced: true, waypointDescription: nextDescription, completed: false }
}

export async function stopNavigation(userId: string): Promise<{ stopped: boolean }> {
  clearNavigationSession(userId)
  try {
    transition(userId, 'idle')
  } catch {
    // Already idle or unreachable — silently accept
  }
  return { stopped: true }
}
