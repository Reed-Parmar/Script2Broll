export type EditorialIntent =
  | 'intro'
  | 'context'
  | 'problem'
  | 'escalation'
  | 'climax'
  | 'effect'
  | 'solution'
  | 'conclusion'

export interface BrollClip {
  video_id: number
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
  status: 'pending' | 'analyzed' | 'assigned'
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
