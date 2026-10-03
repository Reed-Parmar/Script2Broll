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
  Video,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  AlignLeft,
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

type ScriptLayoutMode = 'split' | 'beats_only' | 'script_only'

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
  // Default to 'split' so the RAW SCRIPT is always visibly prominent and accessible!
  const [layoutMode, setLayoutMode] = useState<ScriptLayoutMode>('split')
  const [isScriptExpanded, setIsScriptExpanded] = useState(true)
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

  // Selected beat index to correlate with raw script paragraphs
  const selectedIndex = beats.findIndex((b) => b.id === selectedBeatId)

  return (
    <aside className="h-full flex flex-col bg-[#121319] border-r border-[#242735] select-none min-h-0">
      {/* Panel Top Header */}
      <div className="h-10 px-3 border-b border-[#242735] flex items-center justify-between bg-[#161820]">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-200 truncate">
            Script & Beats
          </span>
          <span className="text-[10px] text-slate-500 font-mono hidden sm:inline">
            ({beats.length} beats)
          </span>
        </div>

        {/* View Layout Selector (Split / Beats / Script) */}
        <div className="flex items-center bg-[#101217] border border-[#242735] rounded p-0.5 text-[10px]">
          <button
            onClick={() => setLayoutMode('split')}
            title="Split View: Raw Script on top, Editorial Beats below"
            className={`px-2 py-0.5 rounded transition-colors ${
              layoutMode === 'split'
                ? 'bg-[#252836] text-blue-400 font-medium'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Split
          </button>
          <button
            onClick={() => setLayoutMode('script_only')}
            title="Full Raw Script Editor"
            className={`px-2 py-0.5 rounded transition-colors ${
              layoutMode === 'script_only'
                ? 'bg-[#252836] text-blue-400 font-medium'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Script
          </button>
          <button
            onClick={() => setLayoutMode('beats_only')}
            title="Beats Sequence View"
            className={`px-2 py-0.5 rounded transition-colors ${
              layoutMode === 'beats_only'
                ? 'bg-[#252836] text-blue-400 font-medium'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Beats
          </button>
        </div>
      </div>

      {/* SECTION 1: PROMINENT RAW SCRIPT VIEW (Visible in 'split' and 'script_only' modes) */}
      {(layoutMode === 'split' || layoutMode === 'script_only') && (
        <div
          className={`flex flex-col border-b border-[#242735] bg-[#14161f] transition-all duration-200 ${
            layoutMode === 'script_only'
              ? 'flex-1 min-h-0'
              : isScriptExpanded
              ? 'h-64 shrink-0'
              : 'h-10 shrink-0'
          }`}
        >
          {/* Section Header */}
          <div className="h-9 px-3 border-b border-[#202330] flex items-center justify-between text-xs bg-[#171923]">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <AlignLeft className="w-3 h-3 text-blue-400" />
                <span>Raw Script (Source of Truth)</span>
              </span>
              <span className="text-[10px] text-slate-500 font-mono">
                {wordCount}w · ~{estimatedSeconds}s
              </span>
            </div>

            <div className="flex items-center gap-1 text-[11px]">
              <button
                onClick={() => fileInputRef.current?.click()}
                title="Upload script file (.txt, .md)"
                className="p-1 text-slate-400 hover:text-white rounded hover:bg-[#202330] flex items-center gap-1"
              >
                <Upload className="w-3 h-3" />
                <span className="text-[10px] hidden sm:inline">Upload</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md"
                className="hidden"
                onChange={handleFileUpload}
              />

              {layoutMode === 'split' && (
                <button
                  onClick={() => setIsScriptExpanded(!isScriptExpanded)}
                  title={isScriptExpanded ? 'Collapse Raw Script' : 'Expand Raw Script'}
                  className="p-1 text-slate-400 hover:text-white rounded hover:bg-[#202330]"
                >
                  {isScriptExpanded ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Script Content / Textarea Body */}
          {isScriptExpanded && (
            <div className="flex-1 p-2.5 flex flex-col gap-2 min-h-0">
              <textarea
                value={scriptText}
                onChange={(e) => onScriptChange(e.target.value)}
                placeholder="Type or paste your narrative script here... Blank lines between paragraphs define natural editorial beats."
                className="flex-1 w-full bg-[#0f1118] border border-[#242735] focus:border-blue-500/60 rounded-md p-2.5 text-xs leading-relaxed text-slate-100 placeholder-slate-600 resize-none focus:outline-none font-sans overflow-y-auto"
              />

              {/* Action Bar for Script */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-[10px] text-slate-500 italic">
                  {selectedIndex >= 0 ? `Synced with Beat ${selectedIndex + 1}` : 'Paragraphs define beats'}
                </span>

                <button
                  onClick={onAnalyzeScript}
                  disabled={!scriptText.trim() || isAnalyzing}
                  className="px-2.5 py-1 text-[11px] font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded flex items-center gap-1 transition-colors shadow-xs"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>{isAnalyzing ? 'Analyzing…' : 'Sync Beats'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SECTION 2: EDITORIAL BEATS BREAKDOWN (Visible in 'split' and 'beats_only' modes) */}
      {(layoutMode === 'split' || layoutMode === 'beats_only') && (
        <div className="flex-1 flex flex-col min-h-0 bg-[#121319]">
          {/* Beats Section Sub-Header */}
          <div className="h-8 px-3 border-b border-[#202330] flex items-center justify-between text-xs bg-[#161822]">
            <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-slate-300 text-[11px]">
              <ListOrdered className="w-3 h-3 text-blue-400" />
              <span>Editorial Beats Breakdown</span>
            </div>

            <button
              onClick={onAddBeat}
              className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-slate-300 hover:text-white bg-[#202330] hover:bg-[#282d3e] rounded border border-[#2c3142] transition-colors"
            >
              <Plus className="w-3 h-3" />
              <span>Add Beat</span>
            </button>
          </div>

          {/* Beats List */}
          {beats.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <div className="w-10 h-10 rounded-full bg-[#1c1e28] border border-[#282c3c] flex items-center justify-center text-slate-400 mb-2">
                <ListOrdered className="w-5 h-5 text-slate-400" />
              </div>
              <h3 className="text-xs font-semibold text-slate-200 mb-1">No beats generated</h3>
              <p className="text-[11px] text-slate-400 max-w-xs mb-3">
                Click &quot;Sync Beats&quot; above to break your raw script into narrative beats.
              </p>
              <button
                onClick={onAnalyzeScript}
                disabled={!scriptText.trim()}
                className="px-3 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded disabled:opacity-40"
              >
                Generate Beats
              </button>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {beats.map((beat) => {
                const isSelected = beat.id === selectedBeatId
                const hasClip = beat.assigned_clip !== null

                return (
                  <div
                    key={beat.id}
                    onClick={() => onSelectBeat(beat.id)}
                    className={`group rounded-md border p-2.5 cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-blue-600/10 border-blue-500/60 shadow-sm'
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

                      <div className="flex items-center gap-1 text-[10px] text-slate-400 font-mono">
                        <Clock className="w-3 h-3 text-slate-500" />
                        <span>{beat.target_duration.toFixed(1)}s</span>
                      </div>
                    </div>

                    {/* Narration Excerpt */}
                    <p className="text-xs text-slate-200 leading-snug line-clamp-2 mb-2 font-sans">
                      &ldquo;{beat.narration}&rdquo;
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
                          <div className="truncate text-slate-300 text-[10px] flex items-center gap-1 font-mono">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span className="truncate">
                              #{beat.assigned_clip!.video_id} &bull; {beat.assigned_clip!.creator || 'B-roll'}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-slate-500 text-[10px]">
                          <Video className="w-3 h-3 text-slate-500" />
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
                          className="p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors"
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

          {/* Bottom Bar: Summary */}
          <div className="p-2 border-t border-[#242735] bg-[#161820] flex items-center justify-between text-[11px] text-slate-400">
            <span>
              {beats.filter((b) => b.assigned_clip !== null).length}/{beats.length} beats assigned
            </span>
            <button
              onClick={() => setLayoutMode(layoutMode === 'split' ? 'script_only' : 'split')}
              className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1"
            >
              {layoutMode === 'split' ? (
                <>
                  <Maximize2 className="w-3 h-3" />
                  <span>Focus Script</span>
                </>
              ) : (
                <>
                  <Minimize2 className="w-3 h-3" />
                  <span>Split View</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}
