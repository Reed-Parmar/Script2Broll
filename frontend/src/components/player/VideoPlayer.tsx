import { useState, useRef, useEffect, type ChangeEvent } from 'react'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize,
  Repeat,
  Sparkles,
  Layers,
  Film,
} from 'lucide-react'
import type { ScriptBeat } from '../../types/editor'
import { mediaUrl } from '../../api/client'

interface VideoPlayerProps {
  activeBeat: ScriptBeat | null
  allBeats: ScriptBeat[]
  playbackMode: 'clip' | 'sequence'
  onPlaybackModeChange: (mode: 'clip' | 'sequence') => void
  onFindBroll: (beatId: string) => void
  currentTime: number
  totalDuration: number
  onSeek: (time: number) => void
  isPlaying: boolean
  onTogglePlay: () => void
  onBeatTimeUpdate?: (beatId: string, time: number) => void
}

function formatTimecode(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00.0'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const tenths = Math.floor((seconds % 1) * 10)
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`
}

export default function VideoPlayer({
  activeBeat,
  allBeats,
  playbackMode,
  onPlaybackModeChange,
  onFindBroll,
  currentTime,
  totalDuration,
  onSeek,
  isPlaying,
  onTogglePlay,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [volume, setVolume] = useState(0.8)
  const [isMuted, setIsMuted] = useState(false)
  const [isLooping, setIsLooping] = useState(false)
  const [hoverTime, setHoverTime] = useState<number | null>(null)

  // Current playing clip determination
  const activeClip = activeBeat?.assigned_clip ?? null

  // In sequence mode, calculate which beat and clip is at currentTime
  let sequenceActiveBeat = activeBeat
  let sequenceClip = activeClip
  let clipLocalTime = currentTime

  if (playbackMode === 'sequence') {
    let accumulated = 0
    for (const b of allBeats) {
      const dur = b.assigned_clip?.duration || b.target_duration
      if (currentTime >= accumulated && currentTime < accumulated + dur) {
        sequenceActiveBeat = b
        sequenceClip = b.assigned_clip
        clipLocalTime = currentTime - accumulated
        break
      }
      accumulated += dur
    }
  }

  // Handle play/pause commands from parent
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (isPlaying) {
      video.play().catch(() => {})
    } else {
      video.pause()
    }
  }, [isPlaying])

  // Synchronize video element time with master time
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const targetTime = playbackMode === 'sequence' ? clipLocalTime : currentTime
    if (Math.abs(video.currentTime - targetTime) > 0.4) {
      video.currentTime = targetTime
    }
  }, [currentTime, clipLocalTime, playbackMode])

  // Sync volume
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = isMuted ? 0 : volume
    }
  }, [volume, isMuted])

  // Handle time updates from native HTML5 video
  function handleTimeUpdate() {
    const video = videoRef.current
    if (!video) return

    if (playbackMode === 'clip') {
      onSeek(video.currentTime)
    } else {
      // In sequence mode, master time advances
      // compute master time from beat offset
      let offset = 0
      for (const b of allBeats) {
        if (b.id === sequenceActiveBeat?.id) {
          break
        }
        offset += b.assigned_clip?.duration || b.target_duration
      }
      onSeek(offset + video.currentTime)
    }
  }

  function handleVideoEnded() {
    if (playbackMode === 'clip') {
      if (isLooping) {
        videoRef.current?.play().catch(() => {})
      } else {
        onTogglePlay()
      }
    } else {
      // In sequence mode, check if there's a next beat
      const currentIndex = allBeats.findIndex((b) => b.id === sequenceActiveBeat?.id)
      if (currentIndex >= 0 && currentIndex < allBeats.length - 1) {
        // Move to start of next beat
        let nextStart = 0
        for (let i = 0; i <= currentIndex; i++) {
          nextStart += allBeats[i].assigned_clip?.duration || allBeats[i].target_duration
        }
        onSeek(nextStart)
      } else {
        if (isLooping) {
          onSeek(0)
        } else {
          onTogglePlay()
        }
      }
    }
  }

  function handleScrubberChange(e: ChangeEvent<HTMLInputElement>) {
    const target = parseFloat(e.target.value)
    onSeek(target)
  }

  function toggleFullscreen() {
    if (!containerRef.current) return
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {})
    } else {
      document.exitFullscreen().catch(() => {})
    }
  }

  const currentDisplayDuration =
    playbackMode === 'sequence'
      ? totalDuration
      : (activeClip?.duration ?? activeBeat?.target_duration ?? 10)

  return (
    <div
      ref={containerRef}
      className="flex-1 flex flex-col bg-[#0b0c10] overflow-hidden select-none min-h-0"
    >
      {/* Top Video HUD Info */}
      <div className="h-9 px-4 border-b border-[#1c1e28] flex items-center justify-between bg-[#121319] text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-blue-600/15 text-blue-400 border border-blue-500/30 font-mono">
            {sequenceActiveBeat ? `BEAT ${String(sequenceActiveBeat.beat_number).padStart(2, '0')}` : 'NO BEAT'}
          </span>

          <span className="text-slate-300 font-medium truncate max-w-sm">
            {sequenceClip
              ? `Footage #${sequenceClip.video_id} · ${sequenceClip.creator || 'Pixabay'}`
              : 'No Footage Assigned'}
          </span>

          {sequenceClip && (
            <span className="text-[10px] text-slate-400 border border-[#242735] px-1.5 py-0.5 rounded hidden md:inline">
              {sequenceClip.width}×{sequenceClip.height}
            </span>
          )}
        </div>

        {/* Playback Mode Switcher */}
        <div className="flex items-center bg-[#161820] border border-[#242735] rounded p-0.5 text-[11px]">
          <button
            onClick={() => onPlaybackModeChange('clip')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded transition-colors ${
              playbackMode === 'clip'
                ? 'bg-[#252836] text-blue-400 font-medium'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Film className="w-3 h-3" />
            <span>Clip Preview</span>
          </button>
          <button
            onClick={() => onPlaybackModeChange('sequence')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded transition-colors ${
              playbackMode === 'sequence'
                ? 'bg-[#252836] text-blue-400 font-medium'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3 h-3" />
            <span>Full Sequence</span>
          </button>
        </div>
      </div>

      {/* Main Video Viewport Canvas */}
      <div className="flex-1 relative flex items-center justify-center p-3 lg:p-6 bg-[#0e0f14] min-h-0">
        <div className="relative aspect-video w-full max-h-full bg-black rounded border border-[#222532] shadow-2xl flex items-center justify-center overflow-hidden">
          {sequenceClip ? (
            <video
              ref={videoRef}
              src={mediaUrl(sequenceClip.video_url)}
              poster={mediaUrl(sequenceClip.thumbnail_url)}
              onTimeUpdate={handleTimeUpdate}
              onEnded={handleVideoEnded}
              playsInline
              onClick={onTogglePlay}
              className="w-full h-full object-contain cursor-pointer"
            />
          ) : (
            /* Empty State in Canvas */
            <div className="flex flex-col items-center justify-center p-6 text-center">
              <div className="w-12 h-12 rounded-full bg-[#181a24] border border-[#242735] flex items-center justify-center text-slate-400 mb-3">
                <Film className="w-6 h-6 text-slate-400" />
              </div>
              <h4 className="text-sm font-semibold text-slate-200 mb-1">
                {sequenceActiveBeat
                  ? `No B-roll assigned to Beat ${sequenceActiveBeat.beat_number}`
                  : 'Select a beat to preview footage'}
              </h4>
              <p className="text-xs text-slate-400 max-w-sm mb-4">
                {sequenceActiveBeat
                  ? `Search the library for "${sequenceActiveBeat.retrieval_query}" or generate automatically.`
                  : 'Assign footage to script beats to build your visual timeline.'}
              </p>
              {sequenceActiveBeat && (
                <button
                  onClick={() => onFindBroll(sequenceActiveBeat.id)}
                  className="px-3.5 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded flex items-center gap-1.5 shadow-sm transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Find B-roll for Beat {sequenceActiveBeat.beat_number}</span>
                </button>
              )}
            </div>
          )}

          {/* Subtitle / Narration Beat Overlay in Canvas */}
          {sequenceActiveBeat && (
            <div className="absolute bottom-4 left-6 right-6 pointer-events-none flex justify-center">
              <div className="bg-black/80 backdrop-blur-sm border border-white/10 px-4 py-1.5 rounded text-xs text-center text-slate-100 max-w-2xl shadow-lg leading-snug">
                “{sequenceActiveBeat.narration}”
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Video Transport Controls Bar */}
      <div className="border-t border-[#1c1e28] bg-[#121319] p-3 flex flex-col gap-2">
        {/* Scrubber Progress Bar */}
        <div className="relative flex items-center group">
          <input
            type="range"
            min={0}
            max={currentDisplayDuration || 10}
            step={0.05}
            value={currentTime}
            onChange={handleScrubberChange}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              const pct = (e.clientX - rect.left) / rect.width
              setHoverTime(Math.max(0, pct * currentDisplayDuration))
            }}
            onMouseLeave={() => setHoverTime(null)}
            className="w-full h-1.5 bg-[#242735] rounded-lg appearance-none cursor-pointer group-hover:h-2 transition-all"
          />

          {hoverTime !== null && (
            <div
              className="absolute -top-7 px-1.5 py-0.5 bg-[#1e212d] border border-[#2d3244] text-[10px] rounded text-slate-200 timecode pointer-events-none shadow"
              style={{
                left: `${Math.min(95, Math.max(5, (hoverTime / currentDisplayDuration) * 100))}%`,
                transform: 'translateX(-50%)',
              }}
            >
              {formatTimecode(hoverTime)}
            </div>
          )}
        </div>

        {/* Buttons & Timecode Row */}
        <div className="flex items-center justify-between text-xs">
          {/* Left: Playback buttons */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onSeek(Math.max(0, currentTime - 1.0))}
              title="Step backward 1s"
              className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-[#1f222e] transition-colors"
            >
              <SkipBack className="w-4 h-4" />
            </button>

            <button
              onClick={onTogglePlay}
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              className="w-8 h-8 rounded bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center shadow transition-colors"
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </button>

            <button
              onClick={() => onSeek(Math.min(currentDisplayDuration, currentTime + 1.0))}
              title="Step forward 1s"
              className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-[#1f222e] transition-colors"
            >
              <SkipForward className="w-4 h-4" />
            </button>

            <button
              onClick={() => setIsLooping(!isLooping)}
              title={isLooping ? 'Disable Loop' : 'Enable Loop'}
              className={`p-1.5 rounded transition-colors ${
                isLooping ? 'text-blue-400 bg-blue-600/15' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Repeat className="w-3.5 h-3.5" />
            </button>

            {/* Timecode Readout */}
            <div className="ml-3 flex items-center gap-1 timecode text-[11px] text-slate-300">
              <span className="font-semibold text-slate-100">{formatTimecode(currentTime)}</span>
              <span className="text-slate-500">/</span>
              <span className="text-slate-400">{formatTimecode(currentDisplayDuration)}</span>
            </div>
          </div>

          {/* Right: Audio Volume & Fullscreen */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-[#161820] border border-[#242735] px-2 py-1 rounded">
              <button
                onClick={() => setIsMuted(!isMuted)}
                className="text-slate-400 hover:text-slate-100"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-3.5 h-3.5 text-rose-400" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={(e) => {
                  setVolume(parseFloat(e.target.value))
                  setIsMuted(false)
                }}
                className="w-16 h-1 bg-[#242735] rounded appearance-none cursor-pointer"
              />
            </div>

            <button
              onClick={toggleFullscreen}
              title="Fullscreen"
              className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-[#1f222e] transition-colors"
            >
              <Maximize className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
