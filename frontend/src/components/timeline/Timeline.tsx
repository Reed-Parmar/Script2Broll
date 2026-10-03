import { useState, useRef, type MouseEvent } from 'react'
import {
  Film,
  ArrowLeft,
  ArrowRight,
  Sparkles,
  Trash2,
  Play,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { ScriptBeat, BrollClip } from '../../types/editor'
import { mediaUrl } from '../../api/client'

interface TimelineProps {
  beats: ScriptBeat[]
  selectedBeatId: string | null
  onSelectBeat: (beatId: string) => void
  onReorderBeats: (sourceIndex: number, targetIndex: number) => void
  onRemoveClip: (beatId: string) => void
  onFindAlternatives: (beatId: string) => void
  currentTime: number
  totalDuration: number
  onSeek: (time: number) => void
  onPreviewClip: (clip: BrollClip) => void
}

function formatRulerTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function Timeline({
  beats,
  selectedBeatId,
  onSelectBeat,
  onReorderBeats,
  onRemoveClip,
  onFindAlternatives,
  currentTime,
  totalDuration,
  onSeek,
  onPreviewClip,
}: TimelineProps) {
  const [pixelsPerSecond, setPixelsPerSecond] = useState(24) // Zoom level
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Calculate cumulative time offsets for each beat
  let accumulatedTime = 0
  const beatOffsets = beats.map((b) => {
    const start = accumulatedTime
    const duration = b.assigned_clip?.duration || b.target_duration
    accumulatedTime += duration
    return {
      beat: b,
      startTime: start,
      duration,
      width: Math.max(120, duration * pixelsPerSecond),
    }
  })

  const timelineTotalWidth = Math.max(800, accumulatedTime * pixelsPerSecond)
  const playheadPosition = currentTime * pixelsPerSecond

  function handleRulerClick(e: MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = e.clientX - rect.left + (scrollContainerRef.current?.scrollLeft || 0)
    const targetSeconds = Math.max(0, Math.min(totalDuration, clickX / pixelsPerSecond))
    onSeek(targetSeconds)
  }

  // Generate ruler tick marks every 5 seconds
  const rulerTicks = []
  const maxRulerSeconds = Math.max(30, Math.ceil(totalDuration / 5) * 5 + 10)
  for (let s = 0; s <= maxRulerSeconds; s += 5) {
    rulerTicks.push(s)
  }

  return (
    <div className="h-60 border-t border-[#242735] bg-[#121319] flex flex-col select-none">
      {/* Timeline Controls & Track Headers */}
      <div className="h-8 px-3 border-b border-[#202330] flex items-center justify-between bg-[#161820] text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-slate-300 text-[11px]">
            <Film className="w-3.5 h-3.5 text-blue-400" />
            <span>Timeline Sequence</span>
          </div>

          <span className="text-[11px] text-slate-500">
            {beats.length} beats · {totalDuration.toFixed(1)}s total duration
          </span>
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 uppercase">Scale:</span>
          <div className="flex items-center border border-[#242735] bg-[#121319] rounded p-0.5">
            <button
              onClick={() => setPixelsPerSecond((prev) => Math.max(14, prev - 4))}
              title="Zoom Out"
              className="p-1 rounded text-slate-400 hover:text-slate-200"
            >
              <ZoomOut className="w-3 h-3" />
            </button>
            <span className="text-[10px] px-1.5 text-slate-400 font-mono">
              {pixelsPerSecond}px/s
            </span>
            <button
              onClick={() => setPixelsPerSecond((prev) => Math.min(48, prev + 4))}
              title="Zoom In"
              className="p-1 rounded text-slate-400 hover:text-slate-200"
            >
              <ZoomIn className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Interactive Ruler & Tracks Viewport */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-x-auto overflow-y-hidden relative bg-[#0e0f14]"
      >
        <div
          className="relative min-h-full"
          style={{ width: `${timelineTotalWidth + 200}px` }}
        >
          {/* Time Ruler */}
          <div
            onClick={handleRulerClick}
            className="h-6 border-b border-[#222534] bg-[#141620] relative cursor-pointer"
          >
            {rulerTicks.map((sec) => (
              <div
                key={sec}
                className="absolute top-0 bottom-0 flex flex-col justify-end"
                style={{ left: `${sec * pixelsPerSecond}px` }}
              >
                <div className="h-2 w-[1px] bg-[#34394c]" />
                <span className="text-[9px] text-slate-500 font-mono ml-1 mb-0.5 select-none">
                  {formatRulerTime(sec)}
                </span>
              </div>
            ))}
          </div>

          {/* Playhead Hairline */}
          <div
            className="absolute top-0 bottom-0 z-30 pointer-events-none flex flex-col items-center"
            style={{ left: `${playheadPosition}px`, transform: 'translateX(-50%)' }}
          >
            {/* Playhead Top Scrubber Handle */}
            <div className="w-3 h-3.5 bg-blue-500 shadow-md transform rotate-45 -mt-1 rounded-sm border border-blue-400" />
            {/* Vertical Line spanning tracks */}
            <div className="w-[1.5px] flex-1 bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]" />
          </div>

          {/* Track 1: Script Beat Labels */}
          <div className="h-7 border-b border-[#1f222e] bg-[#111218] flex items-center relative">
            {beatOffsets.map(({ beat, startTime, width }) => {
              const isSelected = beat.id === selectedBeatId

              return (
                <div
                  key={beat.id}
                  onClick={() => onSelectBeat(beat.id)}
                  style={{ width: `${width}px` }}
                  className={`h-full border-r border-[#202332] px-2 flex items-center justify-between text-[10px] cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-blue-600/20 text-blue-300 font-semibold border-b-2 border-b-blue-500'
                      : 'text-slate-400 hover:bg-[#181a24]'
                  }`}
                >
                  <span className="font-mono truncate">
                    B{String(beat.beat_number).padStart(2, '0')} · {beat.editorial_intent}
                  </span>
                  <span className="text-slate-500 text-[9px] font-mono">
                    {formatRulerTime(startTime)}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Track 2: Visual B-roll Clips */}
          <div className="h-24 bg-[#0d0e13] flex items-center py-2 px-1 relative">
            {beatOffsets.map(({ beat, duration, width }, index) => {
              const isSelected = beat.id === selectedBeatId
              const clip = beat.assigned_clip

              return (
                <div
                  key={beat.id}
                  onClick={() => onSelectBeat(beat.id)}
                  style={{ width: `${width - 4}px` }}
                  className={`h-full mx-0.5 rounded-md border flex flex-col justify-between overflow-hidden cursor-pointer relative group transition-all ${
                    isSelected
                      ? 'border-blue-500 bg-[#1a1f2f] shadow-lg ring-1 ring-blue-500/60'
                      : clip
                      ? 'border-[#282d3d] bg-[#161822] hover:border-[#3a4158]'
                      : 'border-dashed border-[#282d3d] bg-[#14151e] hover:border-slate-600'
                  }`}
                >
                  {clip ? (
                    <>
                      {/* Filmstrip Top Header with Actions */}
                      <div className="px-2 py-1 bg-black/60 backdrop-blur-xs flex items-center justify-between text-[10px] z-10">
                        <div className="flex items-center gap-1 text-slate-200 font-medium truncate">
                          <span className="text-blue-400 font-mono">#{clip.video_id}</span>
                          <span className="truncate">{clip.creator || 'Footage'}</span>
                        </div>

                        {/* Reorder / Action Buttons */}
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          {index > 0 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                onReorderBeats(index, index - 1)
                              }}
                              title="Move Clip Earlier"
                              className="p-0.5 hover:text-white text-slate-400"
                            >
                              <ArrowLeft className="w-3 h-3" />
                            </button>
                          )}
                          {index < beats.length - 1 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                onReorderBeats(index, index + 1)
                              }}
                              title="Move Clip Later"
                              className="p-0.5 hover:text-white text-slate-400"
                            >
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              onRemoveClip(beat.id)
                            }}
                            title="Remove Clip"
                            className="p-0.5 hover:text-rose-400 text-slate-400"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      {/* Filmstrip Thumbnail Background */}
                      <div className="flex-1 relative overflow-hidden flex items-center bg-black/40">
                        <img
                          src={mediaUrl(clip.thumbnail_url)}
                          alt="B-roll filmstrip"
                          className="w-full h-full object-cover opacity-60 group-hover:opacity-85 transition-opacity"
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onPreviewClip(clip)
                          }}
                          className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/30 transition-opacity"
                        >
                          <Play className="w-4 h-4 fill-white text-white" />
                        </button>
                      </div>

                      {/* Bottom Footer: Duration */}
                      <div className="px-2 py-0.5 bg-black/70 flex items-center justify-between text-[9px] text-slate-400 font-mono">
                        <span className="truncate max-w-[80px]">
                          {clip.tags[0] || 'B-roll'}
                        </span>
                        <span>{duration.toFixed(1)}s</span>
                      </div>
                    </>
                  ) : (
                    /* Empty Beat Clip Slot */
                    <div
                      onClick={() => onFindAlternatives(beat.id)}
                      className="w-full h-full flex flex-col items-center justify-center p-2 text-center text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      <Sparkles className="w-4 h-4 mb-1 text-slate-600 group-hover:text-blue-400" />
                      <span className="text-[10px] font-medium">+ Assign Footage</span>
                      <span className="text-[9px] text-slate-600 font-mono mt-0.5">
                        {duration.toFixed(1)}s
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
