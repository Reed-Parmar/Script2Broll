export type HealthStatus = 'ok' | 'not_configured' | 'error' | 'unreachable'

export interface HealthResult {
  status: HealthStatus
  detail?: string
  [key: string]: unknown
}

export interface SearchResult {
  video_id: number
  score: number
  source: string
  source_id: string
  source_url: string
  creator: string | null
  tags: string[]
  duration: number | null
  width: number | null
  height: number | null
  video_url: string
  thumbnail_url: string
}

export type SearchMode = 'semantic' | 'editorial'

export interface EditorialIntentResult {
  original_text: string
  topic: string
  editorial_intent: string
  visual_role: string
  visual_description: string
  retrieval_query: string
}

export interface SearchResponse {
  query: string
  mode: SearchMode
  /** The text that was actually embedded and searched. */
  retrieval_query: string
  editorial: EditorialIntentResult | null
  model: string
  results: SearchResult[]
  timings_ms: Record<string, number>
}

const API_BASE = '/api'

/** Media paths in API responses are relative to the API root. */
export const mediaUrl = (path: string) => `${API_BASE}${path}`

export async function getHealth(path: string): Promise<HealthResult> {
  try {
    const response = await fetch(`${API_BASE}${path}`)
    return (await response.json()) as HealthResult
  } catch {
    return { status: 'unreachable', detail: 'Backend did not respond' }
  }
}

export class SearchError extends Error {}

export async function searchVideos(
  query: string,
  topK: number,
  mode: SearchMode,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, top_k: topK, mode }),
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new SearchError('Could not reach the backend. Is it running?')
  }
  if (response.ok) return (await response.json()) as SearchResponse

  const detail = await response
    .json()
    .then((body) => (typeof body?.detail === 'string' ? body.detail : null))
    .catch(() => null)
  if (response.status === 422) throw new SearchError('Please enter a search query (up to 500 characters).')
  if (response.status === 503 && detail === 'Database unavailable')
    throw new SearchError('The video database is unavailable. Check that PostgreSQL is running.')
  throw new SearchError(detail ? `Search failed: ${detail}` : `Search failed (HTTP ${response.status}).`)
}

export interface Beat {
  beat_id: string
  order: number
  text: string
  status: 'ok' | 'error'
  /** Why this beat has no analysis/results; other beats are unaffected. */
  error: string | null
  editorial_intent: string | null
  topic: string | null
  visual_role: string | null
  visual_description: string | null
  /** Primary query; the clips are the union of this and the alternative queries' results. */
  retrieval_query: string | null
  filmable_visuals: string[]
  alternative_queries: string[]
  /** Non-fatal problems, e.g. one of the queries failed. */
  warnings: string[]
  broll_results: BeatClip[]
}

export interface BeatClip extends SearchResult {
  /** The query that gave this clip its best score. */
  matched_query: string
}

export interface ScriptResponse {
  script: string
  segmentation: { method: 'llm' | 'single_sentence' | 'sentence_fallback'; error: string | null }
  model: string
  top_k: number
  beats: Beat[]
  timings_ms: Record<string, number>
}

export async function analyzeScript(script: string, topK: number, signal?: AbortSignal): Promise<ScriptResponse> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}/v1/script/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script, top_k: topK }),
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new SearchError('Could not reach the backend. Is it running?')
  }
  if (response.ok) return (await response.json()) as ScriptResponse
  const body = await response.json().catch(() => null)
  const detail = typeof body?.detail === 'string' ? body.detail : null
  if (response.status === 422) throw new SearchError(detail ?? 'Please enter a script (up to 5000 characters).')
  throw new SearchError(detail ? `Script analysis failed: ${detail}` : `Script analysis failed (HTTP ${response.status}).`)
}
