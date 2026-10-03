import { useState, useRef, useEffect, useMemo, type ChangeEvent } from 'react'
import {
  FileText,
  Sparkles,
  Upload,
  Play,
  Pause,
  RotateCcw,
  CheckCircle2,
  Clock,
  Video,
  Film,
  Layers,
  ArrowRight,
  Mic,
  Download,
} from 'lucide-react'
import type { ScriptBeat, BrollClip } from '../../types/editor'
import { SAMPLE_SCRIPTS } from '../../data/libraryData'
import { clipDownloadUrl, getVoices, mediaUrl, renderVideo, saveBlob, SearchError, type VoiceOption } from '../../api/client'

/** Stable label: local DB id when present, otherwise the backend's asset key (cloud clips). */
function clipLabel(clip: BrollClip): string {
  return clip.video_id != null ? `#${clip.video_id}` : (clip.asset_key ?? clip.source_id)
}

/** One clip shown for `duration` seconds, starting `start` seconds into the whole sequence. */
interface Segment {
  beatId: string
  clip: BrollClip
  start: number
  duration: number
}

/**
 * The single source of truth for timing: the backend's pacing (`paced_clips[].display_seconds`).
 * A clip the user picked replaces the first paced slot and inherits that slot's duration.
 * Without backend pacing (no paced clips) the assigned clip is shown for its own length.
 */
function beatSegments(beat: ScriptBeat): Omit<Segment, 'start'>[] {
  const paced = (beat.paced_clips ?? []).filter((c) => (c.display_seconds ?? 0) > 0)
  if (paced.length > 0) {
    const assigned = beat.assigned_clip
    const userPicked = assigned && !paced.some((c) => c.asset_key && c.asset_key === assigned.asset_key)
    return paced.map((c, i) => ({
      beatId: beat.id,
      clip: i === 0 && userPicked ? assigned : c,
      duration: c.display_seconds ?? 0,
    }))
  }
  const clip = beat.assigned_clip
  const fallback = clip?.duration && clip.duration > 0 ? clip.duration : 0
  return clip && fallback > 0 ? [{ beatId: beat.id, clip, duration: fallback }] : []
}

function buildPlan(beats: ScriptBeat[]): Segment[] {
  const plan: Segment[] = []
  let start = 0
  for (const beat of beats) {
    for (const seg of beatSegments(beat)) {
      plan.push({ ...seg, start })
      start += seg.duration
    }
  }
  return plan
}

/** On-screen seconds for a beat = sum of its planned segments (same numbers the player uses). */
function beatSeconds(beat: ScriptBeat): number {
  return beatSegments(beat).reduce((acc, seg) => acc + seg.duration, 0)
}

function sourceBadge(clip: BrollClip): string {
  return clip.source_type === 'cloud' ? `Cloud · ${clip.source}` : 'Local'
}

interface ScriptToBeatViewProps {
  scriptText: string
  onScriptChange: (text: string) => void
  onAnalyzeScript: () => void
  beats: ScriptBeat[]
  selectedBeatId: string | null
  onSelectBeat: (beatId: string) => void
  onAssignClipToBeat: (beatId: string, clip: BrollClip) => void
  isAnalyzing: boolean
  onLoadSample: (sampleId: string) => void
  analyzeError?: string | null
  analyzeNote?: string | null
  /** Audio narration upload (.mp3/.wav/.m4a/.ogg): transcribed by the backend, then analysed. */
  onAudioUpload?: (file: File) => void
}

export default function ScriptToBeatView({
  scriptText,
  onScriptChange,
  onAnalyzeScript,
  beats,
  selectedBeatId,
  onSelectBeat,
  onAssignClipToBeat,
  isAnalyzing,
  onLoadSample,
  analyzeError = null,
  analyzeNote = null,
  onAudioUpload,
}: ScriptToBeatViewProps) {
  const audioInputRef = useRef<HTMLInputElement>(null)
  // Live microphone recording -> same transcription + analysis flow as an uploaded audio file.
  const recorderRef = useRef<MediaRecorder | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [micError, setMicError] = useState<string | null>(null)
  // Demo export: optional TTS narration (default deep male narrator) + full video / single-clip download.
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [voice, setVoice] = useState<string>('deep_male_narrator')
  const [withNarration, setWithNarration] = useState(true)
  const [isExporting, setIsExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState<string | null>(null)

  useEffect(() => {
    getVoices()
      .then((res) => {
        setVoices(res.voices)
        setVoice(res.default)
      })
      .catch(() => setVoices([]))
  }, [])

  useEffect(() => {
    if (!isRecording) return
    const timer = setInterval(() => setRecordSeconds((s) => s + 1), 1000)
    return () => clearInterval(timer)
  }, [isRecording])

  async function toggleRecording() {
    if (isRecording) {
      recorderRef.current?.stop()
      return
    }
    setMicError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      const chunks: Blob[] = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        setIsRecording(false)
        const type = recorder.mimeType || 'audio/webm'
        const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm'
        const blob = new Blob(chunks, { type })
        if (blob.size > 0 && onAudioUpload) onAudioUpload(new File([blob], `recording.${ext}`, { type }))
      }
      recorderRef.current = recorder
      setRecordSeconds(0)
      recorder.start()
      setIsRecording(true)
    } catch {
      setMicError('Microphone not available (permission denied or no input device).')
    }
  }
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackMode, setPlaybackMode] = useState<'clip' | 'sequence'>('clip')
  const [showClipPickerForBeatId, setShowClipPickerForBeatId] = useState<string | null>(null)
  // Index into the active playlist and seconds elapsed within that segment.
  const [segIndex, setSegIndex] = useState(0)
  const [segElapsed, setSegElapsed] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const selectedBeat = beats.find((b) => b.id === selectedBeatId) || beats[0] || null

  const wordCount = scriptText.trim() ? scriptText.trim().split(/\s+/).length : 0
  const estimatedSeconds = Math.round(wordCount / 2.3)
  const plan = useMemo(() => buildPlan(beats), [beats])
  const totalDuration = plan.reduce((acc, seg) => acc + seg.duration, 0)
  // Strip items: every planned clip in sequence order; beats without footage get one empty tile.
  const stripItems = beats.flatMap((beat) => {
    const segs = plan.map((seg, planIndex) => ({ seg, planIndex })).filter(({ seg }) => seg.beatId === beat.id)
    if (segs.length === 0) return [{ beat, seg: null as Segment | null, planIndex: -1, shotNumber: 1, shotCount: 1 }]
    return segs.map(({ seg, planIndex }, i) => ({ beat, seg: seg as Segment | null, planIndex, shotNumber: i + 1, shotCount: segs.length }))
  })
  const pickerBeat = beats.find((b) => b.id === showClipPickerForBeatId) ?? null
  const pickerClips = pickerBeat?.candidates ?? []

  // Single-beat mode plays only the selected beat's segments; sequence mode plays everything.
  // In sequence mode the playlist must not depend on the selection (playback itself moves the selection).
  const playlistBeatId = playbackMode === 'sequence' ? null : (selectedBeat?.id ?? null)
  const playlist = useMemo(
    () => (playlistBeatId === null ? plan : plan.filter((seg) => seg.beatId === playlistBeatId)),
    [plan, playlistBeatId],
  )
  const activeSeg: Segment | null = playlist[Math.min(segIndex, playlist.length - 1)] ?? null
  const playlistStart = playlist[0]?.start ?? 0
  const playlistDuration = playlist.reduce((acc, seg) => acc + seg.duration, 0)
  const currentTime = activeSeg ? activeSeg.start - playlistStart + Math.min(segElapsed, activeSeg.duration) : 0

  const sequenceActiveBeat = activeSeg ? (beats.find((b) => b.id === activeSeg.beatId) ?? selectedBeat) : selectedBeat
  const sequenceClip = activeSeg?.clip ?? selectedBeat?.assigned_clip ?? null

  // Restart from the first segment whenever the playlist itself changes (new analysis, mode, beat).
  useEffect(() => {
    setSegIndex(0)
    setSegElapsed(0)
  }, [playlist])

  // Keep the left-hand beat list in sync with what is on screen during sequence playback.
  useEffect(() => {
    if (playbackMode === 'sequence' && activeSeg && activeSeg.beatId !== selectedBeatId) onSelectBeat(activeSeg.beatId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSeg?.beatId, playbackMode])

  // Play/pause follows state; a new segment starts from the clip's beginning (no in-point search).
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (isPlaying) video.play().catch(() => setIsPlaying(false))
    else video.pause()
  }, [isPlaying, segIndex, sequenceClip?.video_url])

  function advance() {
    if (segIndex + 1 < playlist.length) {
      // Same source clip in consecutive segments: the src does not change, so rewind it explicitly.
      if (videoRef.current && playlist[segIndex + 1].clip.video_url === activeSeg?.clip.video_url) {
        videoRef.current.currentTime = 0
      }
      setSegIndex(segIndex + 1)
      setSegElapsed(0)
    } else {
      setIsPlaying(false)
      setSegIndex(0)
      setSegElapsed(0)
      if (videoRef.current) videoRef.current.currentTime = 0
    }
  }

  function handleTimeUpdate() {
    const video = videoRef.current
    if (!video || !activeSeg) return
    setSegElapsed(video.currentTime)
    // Display time from backend pacing is used up: move on even if the source clip is longer.
    if (video.currentTime >= activeSeg.duration) advance()
  }

  async function exportVideo() {
    // Same plan the preview player uses: per beat, its paced clips with their display seconds.
    const renderBeats = beats
      .map((b) => ({
        text: b.narration,
        clips: plan
          .filter((seg) => seg.beatId === b.id && seg.clip.asset_key)
          .map((seg) => ({ asset_key: seg.clip.asset_key as string, seconds: Math.round(seg.duration * 100) / 100 })),
      }))
      .filter((b) => b.clips.length > 0)
    if (renderBeats.length === 0) {
      setExportMessage('Nothing to export yet — analyse the script first.')
      return
    }
    setIsExporting(true)
    setExportMessage(withNarration ? 'Generating narration and rendering video…' : 'Rendering video…')
    try {
      const blob = await renderVideo(renderBeats, withNarration, withNarration ? voice : null)
      saveBlob(blob, 'script2broll_video.mp4')
      setExportMessage(`Video downloaded (${(blob.size / 1_000_000).toFixed(1)} MB).`)
    } catch (error) {
      setExportMessage(error instanceof SearchError ? error.message : 'Export failed.')
    } finally {
      setIsExporting(false)
    }
  }

  function rewind() {
    setSegIndex(0)
    setSegElapsed(0)
    if (videoRef.current) videoRef.current.currentTime = 0
  }

  function handleFileUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (event) => {
        const content = event.target?.result as string
        if (content) onScriptChange(content)
      }
      reader.readAsText(file)
    }
  }

  function formatTime(s: number) {
    const mins = Math.floor(s / 60)
    const secs = Math.floor(s % 60)
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  return (
    <div className="flex-1 flex flex-col p-4 sm:p-6 gap-6 max-w-7xl mx-auto w-full overflow-y-auto">
      {/* SECTION 1: PROMINENT RAW SCRIPT CARD */}
      <section className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-5 shadow-xs transition-colors">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-[var(--border-subtle)] gap-2 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-500">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[var(--text-primary)]">
                Raw Script & Story Narrative
              </h2>
              <p className="text-[11px] text-[var(--text-muted)]">
                Your script drives the visual generation. Blank lines define natural editorial beats.
              </p>
            </div>
          </div>

          {/* Quick Sample Presets & Upload */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-[11px] text-[var(--text-muted)] hidden md:inline">Quick Samples:</span>
            {SAMPLE_SCRIPTS.map((sample) => (
              <button
                key={sample.id}
                onClick={() => onLoadSample(sample.id)}
                className="px-2.5 py-1 text-[11px] rounded-md bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                {sample.title.split(' ')[0]} {sample.title.split(' ')[1]}
              </button>
            ))}

            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-2.5 py-1 text-[11px] rounded-md bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] flex items-center gap-1 transition-colors"
            >
              <Upload className="w-3 h-3" />
              <span>Upload</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md"
              className="hidden"
              onChange={handleFileUpload}
            />

            {onAudioUpload && (
              <>
                <button
                  onClick={() => audioInputRef.current?.click()}
                  disabled={isAnalyzing}
                  title="Upload narration audio (.mp3, .wav, .m4a, .ogg); it is transcribed and analysed"
                  className="px-2.5 py-1 text-[11px] rounded-md bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] flex items-center gap-1 transition-colors disabled:opacity-40"
                >
                  <Mic className="w-3 h-3" />
                  <span>Audio</span>
                </button>
                <button
                  onClick={() => void toggleRecording()}
                  disabled={isAnalyzing && !isRecording}
                  title="Record narration from your microphone; it is transcribed and analysed when you stop"
                  className={`px-2.5 py-1 text-[11px] rounded-md border flex items-center gap-1 transition-colors disabled:opacity-40 ${
                    isRecording
                      ? 'bg-red-600/15 border-red-500 text-red-500'
                      : 'bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border-[var(--border-subtle)] text-[var(--text-secondary)]'
                  }`}
                >
                  <Mic className="w-3 h-3" />
                  <span>{isRecording ? `Stop ● ${formatTime(recordSeconds)}` : 'Record'}</span>
                </button>
                <input
                  ref={audioInputRef}
                  type="file"
                  accept=".mp3,.wav,.m4a,.ogg,audio/mpeg,audio/wav,audio/mp4,audio/ogg"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) onAudioUpload(file)
                    e.target.value = ''
                  }}
                />
              </>
            )}
          </div>
        </div>

        {/* Script Textarea Input */}
        <div className="flex flex-col gap-3">
          <textarea
            value={scriptText}
            onChange={(e) => onScriptChange(e.target.value)}
            rows={4}
            placeholder="Type or paste your narrative script here... Each paragraph will be analyzed into an editorial beat with visual B-roll."
            className="w-full bg-[var(--bg-card)] border border-[var(--border-subtle)] focus:border-blue-500 rounded-lg p-3 text-xs sm:text-sm leading-relaxed text-[var(--text-primary)] placeholder-[var(--text-muted)] resize-none focus:outline-none transition-colors"
          />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-xs text-[var(--text-muted)] font-mono">
              <span>{wordCount} words</span>
              <span>&bull;</span>
              <span>~{estimatedSeconds}s estimated speech</span>
              <span>&bull;</span>
              <span className="text-blue-500 font-semibold">{beats.length} beats generated</span>
            </div>

            <button
              onClick={onAnalyzeScript}
              disabled={!scriptText.trim() || isAnalyzing}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-lg flex items-center gap-2 shadow-xs transition-all hover:scale-[1.01]"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{isAnalyzing ? 'Analyzing Narrative Structure…' : 'Analyze & Generate Beats'}</span>
            </button>
          </div>
          {micError && (
            <p role="alert" className="text-xs text-red-500 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
              {micError}
            </p>
          )}
          {analyzeError && (
            <p role="alert" className="text-xs text-red-500 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
              {analyzeError}
            </p>
          )}
          {analyzeNote && (
            <p role="status" className="text-xs text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">
              {analyzeNote}
            </p>
          )}
        </div>
      </section>

      {/* SECTION 2: BEATS WORKSPACE & VISUAL PREVIEW */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: Narrative Beats Sequence (5 Cols) */}
        <div className="lg:col-span-5 flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
            <span>Editorial Beats ({beats.length})</span>
            <span className="text-[11px] text-[var(--text-muted)] font-mono">
              Click any beat to preview
            </span>
          </div>

          <div className="space-y-3">
            {beats.map((beat) => {
              const isSelected = beat.id === selectedBeatId
              const hasClip = beat.assigned_clip !== null

              return (
                <div
                  key={beat.id}
                  onClick={() => {
                    onSelectBeat(beat.id)
                    if (playbackMode === 'sequence') {
                      const idx = plan.findIndex((seg) => seg.beatId === beat.id)
                      setSegIndex(Math.max(idx, 0))
                      setSegElapsed(0)
                    }
                  }}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[var(--bg-surface)] border-blue-500 shadow-md ring-1 ring-blue-500/40'
                      : 'bg-[var(--bg-surface)] hover:bg-[var(--bg-card)] border-[var(--border-subtle)]'
                  }`}
                >
                  {/* Beat Header */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-blue-600/15 text-blue-500 border border-blue-500/30">
                        BEAT {String(beat.beat_number).padStart(2, '0')}
                      </span>
                      <span className="text-[11px] font-bold uppercase text-[var(--text-muted)] tracking-wider">
                        {beat.editorial_intent}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] font-mono">
                      <Clock className="w-3 h-3" />
                      <span>{beatSeconds(beat).toFixed(1)}s</span>
                    </div>
                  </div>

                  {/* Beat Narration */}
                  <p className="text-xs sm:text-sm text-[var(--text-primary)] leading-relaxed mb-3">
                    &ldquo;{beat.narration}&rdquo;
                  </p>

                  {/* Assigned Footage Info */}
                  <div className="pt-2.5 border-t border-[var(--border-subtle)] flex items-center justify-between text-xs">
                    {hasClip ? (
                      <div className="flex items-center gap-2 min-w-0">
                        <img
                          src={mediaUrl(beat.assigned_clip!.thumbnail_url)}
                          alt="Footage thumbnail"
                          className="w-10 h-6 object-cover rounded bg-black border border-[var(--border-subtle)] shrink-0"
                        />
                        <div className="truncate text-[11px] text-[var(--text-secondary)]">
                          <span className="font-semibold text-emerald-500 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 inline" />
                            {clipLabel(beat.assigned_clip!)}
                          </span>
                          <span className="text-[10px] text-[var(--text-muted)] truncate block">
                            {sourceBadge(beat.assigned_clip!)} · {beat.assigned_clip!.creator || 'Stock B-roll'}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                        <Video className="w-3.5 h-3.5" />
                        <span>{beat.status === 'error' ? `Beat failed: ${beat.error ?? 'unknown error'}` : 'No footage found'}</span>
                      </div>
                    )}

                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelectBeat(beat.id)
                        setShowClipPickerForBeatId(beat.id)
                      }}
                      className="px-2.5 py-1 text-[11px] font-medium text-blue-500 hover:text-blue-600 bg-blue-600/10 hover:bg-blue-600/20 border border-blue-500/30 rounded-md transition-colors"
                    >
                      {hasClip ? 'Change' : 'Select'} Footage
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* RIGHT COLUMN: Video Player & Sequence Strip (7 Cols) */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
            <span>Visual Preview</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPlaybackMode(playbackMode === 'clip' ? 'sequence' : 'clip')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] border font-medium transition-colors ${
                  playbackMode === 'sequence'
                    ? 'bg-blue-600/15 border-blue-500 text-blue-500'
                    : 'bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-muted)]'
                }`}
              >
                <Layers className="w-3 h-3" />
                <span>{playbackMode === 'sequence' ? 'Sequence Mode' : 'Single Beat Mode'}</span>
              </button>
            </div>
          </div>

          {/* Main Video Viewport Canvas */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl overflow-hidden shadow-xs flex flex-col">
            <div className="relative aspect-video w-full bg-black flex items-center justify-center overflow-hidden">
              {sequenceClip?.video_url ? (
                <video
                  ref={videoRef}
                  src={mediaUrl(sequenceClip.video_url)}
                  poster={mediaUrl(sequenceClip.thumbnail_url)}
                  playsInline
                  onClick={() => setIsPlaying(!isPlaying)}
                  onTimeUpdate={handleTimeUpdate}
                  onEnded={advance}
                  muted
                  className="w-full h-full object-contain cursor-pointer"
                />
              ) : (
                <div className="flex flex-col items-center justify-center p-6 text-center text-[var(--text-muted)]">
                  <Film className="w-10 h-10 mb-2 opacity-50" />
                  <p className="text-xs">
                    {sequenceClip ? 'This clip has no playable video URL (provider does not allow playback)' : 'No video assigned to this beat'}
                  </p>
                </div>
              )}

              {/* Subtitle Narration Bar */}
              {sequenceActiveBeat && (
                <div className="absolute bottom-4 left-6 right-6 pointer-events-none flex justify-center">
                  <div className="bg-black/80 backdrop-blur-xs border border-white/10 px-4 py-1.5 rounded-lg text-xs text-center text-white max-w-xl shadow-lg leading-snug">
                    &ldquo;{sequenceActiveBeat.narration}&rdquo;
                  </div>
                </div>
              )}
            </div>

            {/* Video Controls Bar */}
            <div className="p-3.5 border-t border-[var(--border-subtle)] flex items-center justify-between text-xs">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="w-8 h-8 rounded-lg bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center shadow-xs transition-colors"
                >
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                </button>

                <button
                  onClick={rewind}
                  title="Rewind to start"
                  className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>

                <div className="text-[11px] font-mono text-[var(--text-secondary)]">
                  <span>{formatTime(currentTime)}</span>
                  <span className="text-[var(--text-muted)] mx-1">/</span>
                  <span>{formatTime(playlistDuration)}</span>
                </div>
              </div>

              <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-3">
                {sequenceClip?.asset_key && (
                  <a
                    href={clipDownloadUrl(sequenceClip.asset_key)}
                    download
                    className="flex items-center gap-1 text-blue-500 hover:text-blue-600"
                    title="Download this B-roll clip"
                  >
                    <Download className="w-3 h-3" />
                    <span>Download clip</span>
                  </a>
                )}
                {sequenceActiveBeat ? (
                  <span className="font-medium text-[var(--text-primary)]">
                    Beat {sequenceActiveBeat.beat_number} &bull; {sequenceClip ? `${clipLabel(sequenceClip)} (${sourceBadge(sequenceClip)})` : 'No clip'}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {/* Timeline Sequence Strip */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-3.5 shadow-xs">
            <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
              <span>Sequence Timeline Flow ({totalDuration.toFixed(1)}s Total)</span>
              <span className="text-[10px] text-[var(--text-muted)] font-mono">
                {stripItems.filter((item) => item.seg).length} Clips in Series &bull; {beats.length} Beats
              </span>
            </div>

            {/* One tile per clip in the playback plan (a beat can have several paced clips), in order. */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {stripItems.map((item, idx) => {
                const { beat, seg, planIndex } = item
                const isActive =
                  seg && playbackMode === 'sequence' ? activeSeg === seg : beat.id === selectedBeatId
                const clip = seg?.clip ?? null

                return (
                  <div key={seg ? `${beat.id}-${planIndex}` : beat.id} className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => {
                        onSelectBeat(beat.id)
                        if (playbackMode === 'sequence' && planIndex >= 0) {
                          setSegIndex(planIndex)
                          setSegElapsed(0)
                        }
                      }}
                      className={`relative w-28 h-16 rounded-lg overflow-hidden border text-left flex flex-col justify-between p-1.5 transition-all ${
                        isActive
                          ? 'border-blue-500 ring-2 ring-blue-500/40 shadow-xs'
                          : 'border-[var(--border-subtle)] opacity-75 hover:opacity-100'
                      }`}
                    >
                      {clip ? (
                        <img
                          src={mediaUrl(clip.thumbnail_url)}
                          alt="Beat clip"
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      ) : (
                        <div className="absolute inset-0 bg-[var(--bg-card)] flex items-center justify-center">
                          <Film className="w-4 h-4 text-[var(--text-muted)]" />
                        </div>
                      )}

                      <div className="relative z-10 bg-black/75 px-1 py-0.5 rounded text-[9px] font-mono text-white inline-block">
                        B{beat.beat_number}
                        {item.shotCount > 1 ? `.${item.shotNumber}` : ''} &bull; {beat.editorial_intent}
                      </div>

                      <div className="relative z-10 bg-black/75 px-1 py-0.5 rounded text-[8px] font-mono text-slate-300 self-end">
                        {(seg ? seg.duration : 0).toFixed(1)}s
                      </div>
                    </button>

                    {idx < stripItems.length - 1 && (
                      <ArrowRight className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Demo export: narration + full video download */}
          {beats.length > 0 && (
            <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-3.5 text-xs flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Export</span>
                <label className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                  <input type="checkbox" checked={withNarration} onChange={(e) => setWithNarration(e.target.checked)} />
                  <span>AI narration (text-to-speech)</span>
                </label>
                <select
                  value={voice}
                  onChange={(e) => setVoice(e.target.value)}
                  disabled={!withNarration || voices.length === 0}
                  className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-md px-2 py-1 text-[11px] text-[var(--text-primary)] disabled:opacity-40"
                >
                  {voices.length === 0 && <option value={voice}>Deep male narrator</option>}
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => void exportVideo()}
                  disabled={isExporting || isAnalyzing}
                  className="ml-auto px-3 py-1.5 text-[11px] font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-lg flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{isExporting ? 'Rendering…' : 'Download full video'}</span>
                </button>
              </div>
              {exportMessage && <p className="text-[11px] text-[var(--text-muted)]">{exportMessage}</p>}
            </div>
          )}

          {/* AI Editorial Reasoning Card */}
          {selectedBeat && (
            <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-4 text-xs space-y-2">
              <div className="flex items-center gap-2 text-[11px] font-bold text-blue-500 uppercase tracking-wider">
                <Sparkles className="w-3.5 h-3.5" />
                <span>AI Editorial Understanding for Beat {selectedBeat.beat_number}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
                <div>
                  <span className="text-[var(--text-muted)] block font-medium">Visual Role:</span>
                  <span className="text-[var(--text-primary)]">{selectedBeat.visual_role}</span>
                </div>
                <div>
                  <span className="text-[var(--text-muted)] block font-medium">Search Directive:</span>
                  <span className="text-[var(--text-secondary)] font-mono text-[10px] bg-[var(--bg-card)] px-1.5 py-0.5 rounded border border-[var(--border-subtle)] block truncate">
                    {selectedBeat.retrieval_query}
                  </span>
                </div>
              </div>
              {selectedBeat.vibe && selectedBeat.vibe.source !== 'none' && (
                <div className="text-[11px]">
                  <span className="text-[var(--text-muted)] font-medium">Vibe ({selectedBeat.vibe.source}): </span>
                  <span className="text-[var(--text-primary)]">
                    {Object.entries(selectedBeat.vibe.selected)
                      .filter(([, tags]) => tags.length)
                      .map(([category, tags]) => `${category}: ${tags.join(', ')}`)
                      .join(' · ')}
                  </span>
                </div>
              )}
              {(selectedBeat.paced_clips?.length ?? 0) > 0 && (
                <div className="text-[11px]">
                  <span className="text-[var(--text-muted)] font-medium">Pacing: </span>
                  <span className="text-[var(--text-primary)] font-mono">
                    {selectedBeat.paced_clips!
                      .map((c) => `${clipLabel(c)} ${(c.display_seconds ?? 0).toFixed(1)}s${c.pacing_status && c.pacing_status !== 'ok' ? ` (${c.pacing_status})` : ''}`)
                      .join(' → ')}
                    {` = ${(selectedBeat.visual_seconds ?? 0).toFixed(1)}s of ${selectedBeat.target_duration.toFixed(1)}s narration`}
                  </span>
                </div>
              )}
              {(selectedBeat.paced_clips?.length ?? 0) > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="text-[var(--text-muted)] font-medium">Download B-roll:</span>
                  {selectedBeat.paced_clips!
                    .filter((c) => c.asset_key)
                    .map((c) => (
                      <a
                        key={c.asset_key}
                        href={clipDownloadUrl(c.asset_key as string)}
                        download
                        className="flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--border-subtle)] text-blue-500 hover:bg-[var(--bg-hover)]"
                      >
                        <Download className="w-3 h-3" />
                        {clipLabel(c)}
                      </a>
                    ))}
                </div>
              )}
              {[...(selectedBeat.warnings ?? []), ...(selectedBeat.pacing_warnings ?? [])].map((w) => (
                <p key={w} className="text-[11px] text-amber-500">{w}</p>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* QUICK FOOTAGE PICKER MODAL (when user clicks "Change Footage") */}
      {showClipPickerForBeatId && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl shadow-2xl p-5 max-w-2xl w-full flex flex-col gap-4 max-h-[80vh]">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border-subtle)]">
              <div>
                <h3 className="text-sm font-bold text-[var(--text-primary)]">
                  Select Footage for Beat
                </h3>
                <p className="text-xs text-[var(--text-muted)]">
                  {pickerClips.length} candidates for this beat (local library and cloud), ranked by the backend
                </p>
              </div>
              <button
                onClick={() => setShowClipPickerForBeatId(null)}
                className="text-xs px-2.5 py-1 rounded bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Close
              </button>
            </div>

            <div className="flex-1 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-3 p-1">
              {pickerClips.length === 0 && (
                <p className="text-xs text-[var(--text-muted)] col-span-full">No candidates — analyse the script first.</p>
              )}
              {pickerClips.map((clip) => (
                <div
                  key={clip.asset_key ?? clip.video_id ?? clip.source_id}
                  onClick={() => {
                    onAssignClipToBeat(showClipPickerForBeatId, clip)
                    setShowClipPickerForBeatId(null)
                  }}
                  className="rounded-lg border border-[var(--border-subtle)] hover:border-blue-500 overflow-hidden cursor-pointer group bg-[var(--bg-card)] transition-all hover:scale-[1.02]"
                >
                  <div className="aspect-video bg-black relative">
                    <img
                      src={mediaUrl(clip.thumbnail_url)}
                      alt="Thumbnail"
                      className="w-full h-full object-cover"
                    />
                    <span className="absolute bottom-1 right-1 bg-black/80 px-1 py-0.5 rounded text-[9px] text-white font-mono">
                      {Math.round(clip.duration || 10)}s
                    </span>
                  </div>
                  <div className="p-2 text-[10px]">
                    <span className="font-bold text-[var(--text-primary)] block">
                      {clipLabel(clip)} · {sourceBadge(clip)}
                    </span>
                    <span className="text-[var(--text-muted)] truncate block">
                      {clip.tags[0] || 'B-roll'}
                      {clip.display_seconds != null ? ` · ${clip.display_seconds.toFixed(1)}s on screen` : ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
