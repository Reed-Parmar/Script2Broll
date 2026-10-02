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
