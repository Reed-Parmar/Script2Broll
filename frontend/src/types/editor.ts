/** Editorial intent values come from the backend (`EditorialIntent` enum in services/editorial.py). */
export type EditorialIntent = string

export interface BrollClip {
  /** Local DB id (machine-specific); null for cloud clips. Use `asset_key` as the stable id. */
  video_id: number | null
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
  score?: number
  // --- from /v1/script/analyze candidates (Phase 5+) ---
  asset_key?: string
  source_type?: 'local' | 'cloud'
  provider?: string
  page_url?: string
  score_basis?: string
  provider_rank?: number | null
  matched_query?: string
  vibe_score?: number | null
  /** Pacing for this clip in its beat (seconds on screen) and its status. */
  display_seconds?: number
  pacing_status?: 'ok' | 'clip_shorter' | 'unknown_duration'
}

export interface ScriptBeat {
  id: string
  beat_number: number
  narration: string
  editorial_intent: EditorialIntent
  visual_role: string
  visual_description: string
  retrieval_query: string
  assigned_clip: BrollClip | null
  target_duration: number
  status: 'pending' | 'analyzed' | 'assigned' | 'error'
  // --- from /v1/script/analyze (optional so older sample data still type-checks) ---
  backend_beat_id?: string
  topic?: string | null
  error?: string | null
  warnings?: string[]
  alternative_queries?: string[]
  filmable_visuals?: string[]
  /** All B-roll candidates for this beat (local + cloud), in backend order. */
  candidates?: BrollClip[]
  /** Clips chosen by backend pacing, each with display_seconds. */
  paced_clips?: BrollClip[]
  visual_seconds?: number
  pacing_warnings?: string[]
  source_status?: Record<string, { status: string; count: number; detail: string | null }>
  vibe?: BeatVibe | null
}

export type VibeTags = Record<string, string[]>

export interface BeatVibe {
  suggested: VibeTags | null
  selected: VibeTags
  source: 'user' | 'suggested' | 'none'
}

export interface Project {
  id: string
  title: string
  raw_script: string
  beats: ScriptBeat[]
  created_at: string
  updated_at: string
}

export interface PlaybackState {
  isPlaying: boolean
  currentTime: number
  duration: number
  mode: 'clip' | 'sequence'
  activeBeatId: string | null
  volume: number
  isMuted: boolean
  loop: boolean
}

export type GenerationStage =
  | 'idle'
  | 'parsing'
  | 'beats'
  | 'visual_intent'
  | 'retrieving'
  | 'assembling'
  | 'done'
  | 'error'

export interface SampleScript {
  id: string
  title: string
  category: string
  script: string
  suggestedBeats: Omit<ScriptBeat, 'id' | 'status' | 'assigned_clip'>[]
}
