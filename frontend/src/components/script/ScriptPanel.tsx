import { useState, useRef, type ChangeEvent } from 'react'
import {
  FileText,
  ListOrdered,
  Plus,
  Trash2,
  Sparkles,
  Upload,
  CheckCircle2,
  Clock,
  ChevronRight,
  Video,
} from 'lucide-react'
import type { ScriptBeat } from '../../types/editor'
import { mediaUrl } from '../../api/client'

interface ScriptPanelProps {
  scriptText: string
  onScriptChange: (text: string) => void
  onAnalyzeScript: () => void
  beats: ScriptBeat[]
  selectedBeatId: string | null
  onSelectBeat: (beatId: string) => void
  onAddBeat: () => void
  onDeleteBeat: (beatId: string) => void
  onFindBrollForBeat: (beatId: string) => void
  isAnalyzing: boolean
}

export default function ScriptPanel({
  scriptText,
  onScriptChange,
  onAnalyzeScript,
  beats,
  selectedBeatId,
  onSelectBeat,
  onAddBeat,
  onDeleteBeat,
  onFindBrollForBeat,
  isAnalyzing,
}: ScriptPanelProps) {
  const [activeTab, setActiveTab] = useState<'beats' | 'script'>('beats')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const wordCount = scriptText.trim() ? scriptText.trim().split(/\s+/).length : 0
  const estimatedSeconds = Math.round(wordCount / 2.3)

  function handleFileUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (event) => {
        const content = event.target?.result as string
        if (content) {
          onScriptChange(content)
        }
      }
      reader.readAsText(file)
    }
  }

  return (
    <aside className="h-full flex flex-col bg-[#121319] border-r border-[#242735] select-none">
      {/* Panel Header */}
      <div className="h-10 px-3 border-b border-[#242735] flex items-center justify-between bg-[#161820]">
        <div className="flex items-center gap-2">
          <FileText className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Script & Narrative Beats
          </span>
        </div>

        {/* Tab Toggle */}
        <div className="flex bg-[#121319] border border-[#242735] rounded p-0.5 text-[11px]">
          <button
            onClick={() => setActiveTab('beats')}
            className={`px-2 py-0.5 rounded transition-colors ${
              activeTab === 'beats'
                ? 'bg-[#252836] text-blue-400 font-medium'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Beats ({beats.length})
          </button>
          <button
            onClick={() => setActiveTab('script')}
            className={`px-2 py-0.5 rounded transition-colors ${
              activeTab === 'script'
                ? 'bg-[#252836] text-blue-400 font-medium'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Raw Script
          </button>
        </div>
      </div>

      {/* Panel Body */}
      {activeTab === 'script' ? (
        <div className="flex-1 flex flex-col p-3 gap-3 min-h-0">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>
              {wordCount} words · ~{estimatedSeconds}s audio pace
            </span>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1 text-slate-400 hover:text-slate-200 text-[11px]"
            >
              <Upload className="w-3 h-3" />
              Upload (.txt)
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md"
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>

          <textarea
            value={scriptText}
            onChange={(e) => onScriptChange(e.target.value)}
            placeholder="Type or paste your video script here... Break paragraphs to define natural narrative beats."
            className="flex-1 bg-[#161820] border border-[#242735] focus:border-blue-500/50 rounded-md p-3 text-xs leading-relaxed text-slate-200 resize-none focus:outline-none font-sans"
          />

          <button
            onClick={() => {
              onAnalyzeScript()
              setActiveTab('beats')
            }}
            disabled={!scriptText.trim() || isAnalyzing}
            className="w-full py-2 px-3 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600 rounded flex items-center justify-center gap-1.5 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{isAnalyzing ? 'Analyzing Narrative Structure…' : 'Analyze & Break into Beats'}</span>
          </button>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          {beats.length === 0 ? (
            /* Empty State */
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <div className="w-10 h-10 rounded-full bg-[#1c1e28] border border-[#282c3c] flex items-center justify-center text-slate-400 mb-3">
                <ListOrdered className="w-5 h-5 text-slate-400" />
              </div>
              <h3 className="text-xs font-semibold text-slate-200 mb-1">Start with your script</h3>
              <p className="text-[11px] text-slate-400 max-w-xs mb-4">
                Paste or upload your script to break it into editorial narrative beats and find visual B-roll.
              </p>
              <button
                onClick={() => setActiveTab('script')}
                className="px-3 py-1.5 text-xs font-medium text-slate-200 bg-[#1c1e28] hover:bg-[#252836] border border-[#282c3c] rounded transition-colors"
              >
                Paste Script
              </button>
            </div>
          ) : (
            /* Beat List */
            <div className="flex-1 overflow-y-auto divide-y divide-[#1e212c] p-2 space-y-2">
              {beats.map((beat) => {
                const isSelected = beat.id === selectedBeatId
                const hasClip = beat.assigned_clip !== null

                return (
                  <div
                    key={beat.id}
                    onClick={() => onSelectBeat(beat.id)}
                    className={`group rounded-md border p-2.5 cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-blue-600/10 border-blue-500/50 shadow-sm'
                        : 'bg-[#161820] hover:bg-[#1a1d26] border-[#222532]'
                    }`}
                  >
                    {/* Top Row: Beat Number, Editorial Intent, Duration */}
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-mono ${
                            isSelected
                              ? 'bg-blue-600/20 text-blue-400 border border-blue-500/40'
                              : 'bg-[#202330] text-slate-400 border border-[#2a2e3d]'
                          }`}
                        >
                          BEAT {String(beat.beat_number).padStart(2, '0')}
                        </span>
                        <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wide">
                          {beat.editorial_intent}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 text-[10px] text-slate-400">
                        <Clock className="w-3 h-3 text-slate-400" />
                        <span>{beat.target_duration.toFixed(1)}s</span>
                      </div>
                    </div>

                    {/* Narration Excerpt */}
                    <p className="text-xs text-slate-200 leading-snug line-clamp-2 mb-2">
                      “{beat.narration}”
                    </p>

                    {/* Bottom Status / Clip Info */}
                    <div className="flex items-center justify-between pt-1 border-t border-[#202330] text-[11px]">
                      {hasClip ? (
                        <div className="flex items-center gap-1.5 min-w-0">
                          <img
                            src={mediaUrl(beat.assigned_clip!.thumbnail_url)}
                            alt="B-roll thumbnail"
                            className="w-8 h-5 object-cover rounded bg-black border border-[#2a2e3d]"
                          />
                          <div className="truncate text-slate-300 text-[10px] flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span className="truncate">
                              #{beat.assigned_clip!.video_id} · {beat.assigned_clip!.creator || 'B-roll'}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-slate-400 text-[10px]">
                          <Video className="w-3 h-3 text-slate-400" />
                          <span>No footage assigned</span>
                        </div>
                      )}

                      <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onFindBrollForBeat(beat.id)
                          }}
                          title="Search library for footage matching this beat"
                          className="px-2 py-0.5 text-[10px] text-blue-400 hover:text-blue-300 hover:bg-blue-600/10 rounded transition-colors"
                        >
                          Find B-roll
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onDeleteBeat(beat.id)
                          }}
                          title="Remove beat"
                          className="p-1 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Bottom Actions */}
          <div className="p-2 border-t border-[#242735] bg-[#161820] flex items-center justify-between">
            <button
              onClick={onAddBeat}
              className="flex items-center gap-1 px-2.5 py-1 text-xs text-slate-300 hover:text-white hover:bg-[#202330] rounded border border-[#2a2e3d] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Beat</span>
            </button>

            <button
              onClick={() => setActiveTab('script')}
              className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-0.5"
            >
              <span>Edit Full Script</span>
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}
