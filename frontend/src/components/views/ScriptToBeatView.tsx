import { useState, useRef, useEffect, type ChangeEvent } from 'react'
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
} from 'lucide-react'
import type { ScriptBeat, BrollClip } from '../../types/editor'
import { SAMPLE_SCRIPTS, LOCAL_LIBRARY_CLIPS } from '../../data/libraryData'
import { mediaUrl } from '../../api/client'

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
}: ScriptToBeatViewProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [playbackMode, setPlaybackMode] = useState<'clip' | 'sequence'>('clip')
  const [showClipPickerForBeatId, setShowClipPickerForBeatId] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const selectedBeat = beats.find((b) => b.id === selectedBeatId) || beats[0] || null
  const activeClip = selectedBeat?.assigned_clip ?? null

  const wordCount = scriptText.trim() ? scriptText.trim().split(/\s+/).length : 0
  const estimatedSeconds = Math.round(wordCount / 2.3)
  const totalDuration = beats.reduce((acc, b) => acc + (b.assigned_clip?.duration || b.target_duration), 0)

  // Handle Play/Pause
  useEffect(() => {
    if (isPlaying) {
      videoRef.current?.play().catch(() => {})
    } else {
      videoRef.current?.pause()
    }
  }, [isPlaying, activeClip?.video_id])

  // Sequence playback mode calculation
  let sequenceActiveBeat = selectedBeat
  let sequenceClip = activeClip
  if (playbackMode === 'sequence') {
    let acc = 0
    for (const b of beats) {
      const dur = b.assigned_clip?.duration || b.target_duration
      if (currentTime >= acc && currentTime < acc + dur) {
        sequenceActiveBeat = b
        sequenceClip = b.assigned_clip
        break
      }
      acc += dur
    }
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
                    setCurrentTime(0)
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
                      <span>{beat.target_duration.toFixed(1)}s</span>
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
                            #{beat.assigned_clip!.video_id}
                          </span>
                          <span className="text-[10px] text-[var(--text-muted)] truncate block">
                            {beat.assigned_clip!.creator || 'Stock B-roll'}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                        <Video className="w-3.5 h-3.5" />
                        <span>No footage assigned</span>
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
              {sequenceClip ? (
                <video
                  ref={videoRef}
                  src={mediaUrl(sequenceClip.video_url)}
                  poster={mediaUrl(sequenceClip.thumbnail_url)}
                  playsInline
                  onClick={() => setIsPlaying(!isPlaying)}
                  onEnded={() => setIsPlaying(false)}
                  className="w-full h-full object-contain cursor-pointer"
                />
              ) : (
                <div className="flex flex-col items-center justify-center p-6 text-center text-[var(--text-muted)]">
                  <Film className="w-10 h-10 mb-2 opacity-50" />
                  <p className="text-xs">No video assigned to this beat</p>
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
                  onClick={() => {
                    setCurrentTime(0)
                    if (videoRef.current) videoRef.current.currentTime = 0
                  }}
                  title="Rewind to start"
                  className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>

                <div className="text-[11px] font-mono text-[var(--text-secondary)]">
                  <span>{formatTime(currentTime)}</span>
                  <span className="text-[var(--text-muted)] mx-1">/</span>
                  <span>{formatTime(sequenceClip?.duration || 10)}</span>
                </div>
              </div>

              <div className="text-[11px] text-[var(--text-muted)]">
                {sequenceActiveBeat ? (
                  <span className="font-medium text-[var(--text-primary)]">
                    Beat {sequenceActiveBeat.beat_number} &bull; {sequenceClip ? `#${sequenceClip.video_id}` : 'No clip'}
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
                {beats.length} Clips in Series
              </span>
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {beats.map((beat, idx) => {
                const isSelected = beat.id === selectedBeatId
                const clip = beat.assigned_clip

                return (
                  <div key={beat.id} className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => {
                        onSelectBeat(beat.id)
                        setCurrentTime(0)
                      }}
                      className={`relative w-28 h-16 rounded-lg overflow-hidden border text-left flex flex-col justify-between p-1.5 transition-all ${
                        isSelected
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
                        B{beat.beat_number} &bull; {beat.editorial_intent}
                      </div>

                      <div className="relative z-10 bg-black/75 px-1 py-0.5 rounded text-[8px] font-mono text-slate-300 self-end">
                        {beat.target_duration.toFixed(1)}s
                      </div>
                    </button>

                    {idx < beats.length - 1 && (
                      <ArrowRight className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                    )}
                  </div>
                )
              })}
            </div>
          </div>

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
                  Choose from the 42 local high-definition library clips
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
              {LOCAL_LIBRARY_CLIPS.slice(0, 18).map((clip) => (
                <div
                  key={clip.video_id}
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
                      Clip #{clip.video_id}
                    </span>
                    <span className="text-[var(--text-muted)] truncate block">
                      {clip.tags[0] || 'B-roll'}
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
