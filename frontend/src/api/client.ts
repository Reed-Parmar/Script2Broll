/**
 * The single API client for the Script2Broll backend. Every request goes through API_BASE.
 *
 * API_BASE defaults to `/api`, which the Vite dev server proxies to the backend
 * (target: VITE_BACKEND_URL, see vite.config.ts). Set VITE_API_BASE to call a backend directly
 * (e.g. `http://localhost:8000`), in which case the backend's CORS_ORIGINS must allow this origin.
 * No provider keys ever live in the frontend; cloud thumbnails come through the backend proxy.
 */
import type { BeatVibe, BrollClip, ScriptBeat } from '../types/editor'

export type HealthStatus = 'ok' | 'not_configured' | 'error' | 'unreachable'

export interface HealthResult {
  status: HealthStatus
  detail?: string
  [key: string]: unknown
}

/** One local clip from /v1/search (backend `SearchResult`). */
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
  filmable_visuals?: string[]
  alternative_queries?: string[]
}

export interface SearchResponse {
  query: string
  mode: SearchMode
  /** The text that was actually embedded and searched. */
  retrieval_query: string
  editorial: EditorialIntentResult | null
  /** Editorial mode: whether the intent came from the request ("user") or the model. */
  intent_source?: 'user' | 'model' | null
  /** Editorial mode: vibe tags applied to the ranking. */
  vibe?: Record<string, string[]> | null
  model: string
  results: SearchResult[]
  timings_ms: Record<string, number>
}

const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '/api'

/** Backend media paths ("/v1/videos/7/file") are relative to the API root; absolute URLs (permitted
 * cloud video URLs returned by the backend) are used as provided. */
export const mediaUrl = (path: string | null | undefined): string => {
  if (!path) return ''
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  if (path.startsWith(`${API_BASE}/`)) return path
  return path.startsWith('/') ? `${API_BASE}${path}` : `${API_BASE}/${path}`
}

export class SearchError extends Error {}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new SearchError('Could not reach the backend. Is it running?')
  }
  if (response.ok) {
    try {
      return (await response.json()) as T
    } catch {
      throw new SearchError('The backend returned an unreadable response.')
    }
  }
  const payload = await response.json().catch(() => null)
  const detail = typeof payload?.detail === 'string' ? payload.detail : null
  if (response.status === 422) throw new SearchError(detail ?? 'The request was rejected as invalid (HTTP 422).')
  if (response.status === 503) throw new SearchError(detail ?? 'A backend service is unavailable (HTTP 503).')
  throw new SearchError(detail ? `Request failed: ${detail}` : `Request failed (HTTP ${response.status}).`)
}

export async function getHealth(path: string): Promise<HealthResult> {
  try {
    const response = await fetch(`${API_BASE}${path}`)
    return (await response.json()) as HealthResult
  } catch {
    return { status: 'unreachable', detail: 'Backend did not respond' }
  }
}

/** Editorial-mode options for /v1/search: an editor-chosen intent and vibe tags (backend vocabularies). */
export interface EditorialOptions {
  intent?: string | null
  vibe?: Record<string, string[]> | null
}

/** POST /v1/search. `editorial` mode lets the backend's LLM interpret the text first. */
export async function searchVideos(
  query: string,
  topK = 12,
  mode: SearchMode = 'semantic',
  signal?: AbortSignal,
  editorialOptions: EditorialOptions = {},
): Promise<SearchResponse> {
  const trimmed = query.trim()
  if (!trimmed) throw new SearchError('Please enter a search query.')
  const body: Record<string, unknown> = { query: trimmed, top_k: topK, mode }
  if (mode === 'editorial' && editorialOptions.intent) body.intent = editorialOptions.intent
  if (mode === 'editorial' && editorialOptions.vibe && Object.keys(editorialOptions.vibe).length) body.vibe = editorialOptions.vibe
  const data = await postJson<SearchResponse>('/v1/search', body, signal)
  return { ...data, results: Array.isArray(data.results) ? data.results : [] }
}

// ---------------------------------------------------------------------------------------------
// /v1/script/analyze (backend api/script.py is authoritative)

/** Local or cloud candidate (backend `CandidateOut`). */
export interface Candidate {
  asset_key: string
  source_type: 'local' | 'cloud'
  provider: string
  provider_asset_id: string
  video_id: number | null
  display_name: string
  page_url: string
  creator: string | null
  title: string | null
  tags: string[]
  duration: number | null
  width: number | null
  height: number | null
  thumbnail_url: string
  media_url: string | null
  exportable: boolean
  similarity: number | null
  score_basis: string
  provider_rank: number | null
  matched_query: string
  vibe_score: number | null
}

export interface ClipPacing {
  beat_id: string
  asset_key: string
  source_type: string
  provider: string
  clip_duration: number | null
  display_seconds: number
  status: 'ok' | 'clip_shorter' | 'unknown_duration'
}

export interface BeatPacing {
  narration_seconds: number
  basis: string
  shot_durations: number[]
  clips: ClipPacing[]
  visual_seconds: number
  warnings: string[]
}

export interface SourceStatus {
  status: string
  count: number
  detail: string | null
  requests: number
  cache_hits: number
  latency_ms: number
}

export interface BeatClip extends SearchResult {
  /** The query that gave this clip its best score. */
  matched_query: string
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
  retrieval_query: string | null
  filmable_visuals: string[]
  alternative_queries: string[]
  warnings: string[]
  /** Local results only (kept for compatibility). */
  broll_results: BeatClip[]
  /** Local + cloud candidates, labelled by source. */
  candidates?: Candidate[]
  source_status?: Record<string, SourceStatus>
  pacing?: BeatPacing | null
  vibe?: BeatVibe | null
}

export interface ScriptResponse {
  script: string
  segmentation: { method: 'llm' | 'single_sentence' | 'sentence_fallback'; error: string | null }
  model: string
  top_k: number
  beats: Beat[]
  timings_ms: Record<string, number>
  total_narration_seconds?: number | null
}

export interface ScriptAnalyzeOptions {
  topK?: number
  /** Mix of local and cloud candidates per beat; cloud needs CLOUD_PROVIDERS on the backend. */
  retrieval?: { local_k: number; cloud_k: number; cloud_providers: string[]; fill?: 'strict' | 'backfill' }
  vibe?: { suggest?: boolean; selected?: Record<string, string[]>; per_beat?: Record<string, Record<string, string[]>> }
  signal?: AbortSignal
}

export async function analyzeScript(script: string, options: ScriptAnalyzeOptions = {}): Promise<ScriptResponse> {
  if (!script.trim()) throw new SearchError('Please enter a script.')
  const body: Record<string, unknown> = { script, top_k: options.topK ?? 12 }
  if (options.retrieval) body.retrieval = options.retrieval
  if (options.vibe) body.vibe = options.vibe
  const data = await postJson<ScriptResponse>('/v1/script/analyze', body, options.signal)
  return { ...data, beats: Array.isArray(data.beats) ? data.beats : [] }
}

export interface IntentOption {
  value: string
  description: string
}

/** GET /v1/editorial/intents — the backend's editorial intent enum (authoritative). */
export async function getEditorialIntents(): Promise<IntentOption[]> {
  const response = await fetch(`${API_BASE}/v1/editorial/intents`)
  if (!response.ok) throw new SearchError(`Could not load editorial intents (HTTP ${response.status}).`)
  return (await response.json()) as IntentOption[]
}

/** GET /v1/script/vibe/vocabulary — the backend's controlled vibe tag vocabulary (authoritative). */
export async function getVibeVocabulary(): Promise<Record<string, string[]>> {
  const response = await fetch(`${API_BASE}/v1/script/vibe/vocabulary`)
  if (!response.ok) throw new SearchError(`Could not load vibe tags (HTTP ${response.status}).`)
  return (await response.json()) as Record<string, string[]>
}

/** Map a backend candidate to the clip shape the UI renders. Source comes from the backend fields. */
export function candidateToClip(c: Candidate, pacing?: ClipPacing): BrollClip {
  return {
    video_id: c.video_id,
    source: c.display_name,
    source_id: c.provider_asset_id,
    source_url: c.page_url,
    creator: c.creator,
    tags: c.tags ?? [],
    duration: c.duration,
    width: c.width,
    height: c.height,
    video_url: c.media_url ?? '',
    thumbnail_url: c.thumbnail_url,
    score: c.similarity ?? undefined,
    asset_key: c.asset_key,
    source_type: c.source_type,
    provider: c.provider,
    page_url: c.page_url,
    score_basis: c.score_basis,
    provider_rank: c.provider_rank,
    matched_query: c.matched_query,
    vibe_score: c.vibe_score,
    display_seconds: pacing?.display_seconds,
    pacing_status: pacing?.status,
  }
}

/** Map a /v1/script/analyze beat to the editor's ScriptBeat (real data only; no defaults invented). */
export function beatToScriptBeat(beat: Beat): ScriptBeat {
  const pacing = beat.pacing ?? null
  const paceByKey = new Map((pacing?.clips ?? []).map((p) => [p.asset_key, p]))
  // Older responses have no `candidates`: fall back to the local `broll_results`.
  const candidates: BrollClip[] = beat.candidates
    ? beat.candidates.map((c) => candidateToClip(c, paceByKey.get(c.asset_key)))
    : beat.broll_results.map((r) => ({ ...r, source_type: 'local' as const, matched_query: r.matched_query }))
  const paced = candidates.filter((c) => c.asset_key && paceByKey.has(c.asset_key))
  return {
    id: beat.beat_id,
    backend_beat_id: beat.beat_id,
    beat_number: beat.order,
    narration: beat.text,
    editorial_intent: beat.editorial_intent ?? (beat.status === 'error' ? 'error' : 'unknown'),
    visual_role: beat.visual_role ?? '',
    visual_description: beat.visual_description ?? '',
    retrieval_query: beat.retrieval_query ?? '',
    assigned_clip: paced[0] ?? candidates[0] ?? null,
    target_duration: pacing?.narration_seconds ?? 0,
    status: beat.status === 'error' ? 'error' : candidates.length ? 'assigned' : 'analyzed',
    topic: beat.topic,
    error: beat.error,
    warnings: beat.warnings ?? [],
    alternative_queries: beat.alternative_queries ?? [],
    filmable_visuals: beat.filmable_visuals ?? [],
    candidates,
    paced_clips: paced,
    visual_seconds: pacing?.visual_seconds,
    pacing_warnings: pacing?.warnings ?? [],
    source_status: beat.source_status,
    vibe: beat.vibe ?? null,
  }
}

export interface TranscriptResult {
  text: string
  language: string | null
  duration: number | null
  model: string
}

/** POST /v1/script/transcribe — audio narration (.mp3/.wav/.m4a/.ogg) to text (local Whisper on the backend). */
export async function transcribeAudio(file: File, signal?: AbortSignal): Promise<TranscriptResult> {
  const form = new FormData()
  form.append('file', file)
  let response: Response
  try {
    response = await fetch(`${API_BASE}/v1/script/transcribe`, { method: 'POST', body: form, signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new SearchError('Could not reach the backend. Is it running?')
  }
  if (response.ok) return (await response.json()) as TranscriptResult
  const payload = await response.json().catch(() => null)
  const detail = typeof payload?.detail === 'string' ? payload.detail : null
  throw new SearchError(detail ? `Transcription failed: ${detail}` : `Transcription failed (HTTP ${response.status}).`)
}

// ---------------------------------------------------------------------------------------------
// Demo export: TTS narration voices, full-video render, single-clip download (backend api/export.py)

export interface VoiceOption {
  id: string
  label: string
}

export async function getVoices(): Promise<{ default: string; voices: VoiceOption[] }> {
  const response = await fetch(`${API_BASE}/v1/export/voices`)
  if (!response.ok) throw new SearchError(`Could not load narration voices (HTTP ${response.status}).`)
  return (await response.json()) as { default: string; voices: VoiceOption[] }
}

export interface RenderBeat {
  text: string
  clips: { asset_key: string; seconds: number }[]
}

/** Render the beats (+ optional narration) to an MP4 and return it as a Blob. */
export async function renderVideo(beats: RenderBeat[], narration: boolean, voice: string | null): Promise<Blob> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}/v1/export/video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ beats, narration, voice }),
    })
  } catch {
    throw new SearchError('Could not reach the backend. Is it running?')
  }
  if (response.ok) return await response.blob()
  const payload = await response.json().catch(() => null)
  const detail = typeof payload?.detail === 'string' ? payload.detail : null
  throw new SearchError(detail ? `Export failed: ${detail}` : `Export failed (HTTP ${response.status}).`)
}

/** Backend download URL for one B-roll clip (local file or cloud clip fetched by the backend). */
export const clipDownloadUrl = (assetKey: string): string => `${API_BASE}/v1/export/clip/${encodeURIComponent(assetKey)}`

/** Save a Blob as a file in the browser. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
