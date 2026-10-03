import { Play, ArrowLeft, ArrowRight, Trash2, Video, CheckCircle2, Clock } from 'lucide-react'
import type { ScriptBeat, BrollClip } from '../../types/editor'
import { mediaUrl } from '../../api/client'

interface StoryboardProps {
  beats: ScriptBeat[]
  selectedBeatId: string | null
  onSelectBeat: (beatId: string) => void
  onReorderBeats: (sourceIndex: number, targetIndex: number) => void
  onRemoveClip: (beatId: string) => void
  onFindAlternatives: (beatId: string) => void
  onPreviewClip: (clip: BrollClip) => void
}

export default function Storyboard({
  beats,
  selectedBeatId,
  onSelectBeat,
  onReorderBeats,
  onRemoveClip,
  onFindAlternatives,
  onPreviewClip,
}: StoryboardProps) {
  if (beats.length === 0) {
    return (
      <div className="h-60 border-t border-[#242735] bg-[#121319] flex items-center justify-center p-6 text-center text-slate-500">
        <p className="text-xs">Add a script to generate storyboard sequences.</p>
      </div>
    )
  }

  return (
    <div className="h-60 border-t border-[#242735] bg-[#121319] flex flex-col select-none overflow-hidden">
      {/* Header */}
      <div className="h-8 px-4 border-b border-[#202330] flex items-center justify-between bg-[#161820] text-xs">
        <span className="font-semibold uppercase tracking-wider text-slate-300 text-[11px]">
          Storyboard Narrative Sequence ({beats.length} Beats)
        </span>
        <span className="text-[11px] text-slate-500">
          Pairs narrative script beats with corresponding visuals
        </span>
      </div>

      {/* Horizontal Storyboard Card Strip */}
      <div className="flex-1 overflow-x-auto p-3 flex gap-3 items-center min-h-0 bg-[#0e0f14]">
        {beats.map((beat, index) => {
          const isSelected = beat.id === selectedBeatId
          const clip = beat.assigned_clip

          return (
            <div
              key={beat.id}
              onClick={() => onSelectBeat(beat.id)}
              className={`w-72 shrink-0 h-full rounded-md border flex flex-col justify-between overflow-hidden cursor-pointer transition-all bg-[#161820] ${
                isSelected
                  ? 'border-blue-500 ring-1 ring-blue-500/50 shadow-md'
                  : 'border-[#242735] hover:border-[#383c4e]'
              }`}
            >
              {/* Card Top: Beat Header */}
              <div className="px-3 py-1.5 bg-[#1a1d28] border-b border-[#242735] flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5 font-mono">
                  <span className="font-bold text-blue-400">
                    BEAT {String(beat.beat_number).padStart(2, '0')}
                  </span>
                  <span className="text-[#5e6475]">·</span>
                  <span className="text-slate-400 uppercase text-[10px] font-semibold">
                    {beat.editorial_intent}
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  {index > 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onReorderBeats(index, index - 1)
                      }}
                      title="Move Earlier"
                      className="p-1 hover:text-white text-slate-500"
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
                      title="Move Later"
                      className="p-1 hover:text-white text-slate-500"
                    >
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Card Middle: Script Text + Visual Thumbnail */}
              <div className="p-2.5 flex-1 flex gap-2.5 min-h-0">
                {/* Script Narration */}
                <div className="flex-1 flex flex-col justify-between text-[11px]">
                  <p className="text-slate-300 leading-snug line-clamp-3 italic">
                    “{beat.narration}”
                  </p>
                  <div className="text-[10px] text-slate-500 flex items-center gap-1 mt-1 font-mono">
                    <Clock className="w-3 h-3" />
                    <span>{beat.target_duration.toFixed(1)}s</span>
                  </div>
                </div>

                {/* Visual Thumbnail */}
                <div className="w-24 shrink-0 aspect-video rounded bg-black border border-[#242735] overflow-hidden relative group">
                  {clip ? (
                    <>
                      <img
                        src={mediaUrl(clip.thumbnail_url)}
                        alt="Beat clip"
                        className="w-full h-full object-cover"
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onPreviewClip(clip)
                        }}
                        className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity"
                      >
                        <Play className="w-4 h-4 fill-white" />
                      </button>
                    </>
                  ) : (
                    <div
                      onClick={(e) => {
                        e.stopPropagation()
                        onFindAlternatives(beat.id)
                      }}
                      className="w-full h-full flex flex-col items-center justify-center text-slate-500 hover:text-blue-400 transition-colors"
                    >
                      <Video className="w-4 h-4 mb-0.5" />
                      <span className="text-[8px] font-medium">+ Assign</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Card Bottom: Status & Quick Actions */}
              <div className="px-3 py-1.5 bg-[#121319] border-t border-[#202330] flex items-center justify-between text-[10px]">
                {clip ? (
                  <div className="flex items-center gap-1 text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" />
                    <span className="truncate max-w-[120px]">
                      #{clip.video_id} · {clip.creator || 'Pixabay'}
                    </span>
                  </div>
                ) : (
                  <span className="text-slate-500">Unassigned</span>
                )}

                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onFindAlternatives(beat.id)
                    }}
                    className="text-blue-400 hover:text-blue-300 font-medium"
                  >
                    {clip ? 'Replace' : 'Find B-roll'}
                  </button>
                  {clip && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemoveClip(beat.id)
                      }}
                      className="text-slate-500 hover:text-rose-400"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
