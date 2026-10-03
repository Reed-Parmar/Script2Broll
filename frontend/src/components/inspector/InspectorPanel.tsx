import { useState, useEffect, useRef, type FormEvent } from 'react'
import {
  SlidersHorizontal,
  Search,
  RefreshCw,
  ExternalLink,
  Trash2,
  Play,
  ArrowRight,
} from 'lucide-react'
import type { ScriptBeat, BrollClip, EditorialIntent } from '../../types/editor'
import { searchVideos, mediaUrl, type SearchResult } from '../../api/client'

interface InspectorPanelProps {
  selectedBeat: ScriptBeat | null
  onUpdateBeatMetadata: (
    beatId: string,
    updates: Partial<Pick<ScriptBeat, 'editorial_intent' | 'visual_role' | 'visual_description' | 'retrieval_query'>>
  ) => void
  onAssignClipToBeat: (beatId: string, clip: BrollClip) => void
  onRemoveClipFromBeat: (beatId: string) => void
  onPreviewClip: (clip: BrollClip) => void
}

const INTENT_OPTIONS: EditorialIntent[] = [
  'intro',
  'context',
  'problem',
  'escalation',
  'solution',
  'effect',
  'conclusion',
]

export default function InspectorPanel({
  selectedBeat,
  onUpdateBeatMetadata,
  onAssignClipToBeat,
  onRemoveClipFromBeat,
  onPreviewClip,
}: InspectorPanelProps) {
  const [activeTab, setActiveTab] = useState<'analysis' | 'search'>('analysis')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [hoveredResultId, setHoveredResultId] = useState<number | null>(null)
  const previewVideoRef = useRef<HTMLVideoElement>(null)

  // Sync search query when selected beat changes
  useEffect(() => {
    if (selectedBeat?.retrieval_query) {
      setSearchQuery(selectedBeat.retrieval_query)
      // Pre-load search for the beat
      void executeSearch(selectedBeat.retrieval_query)
    }
  }, [selectedBeat?.id, selectedBeat?.retrieval_query])

  async function executeSearch(queryText: string) {
    if (!queryText.trim()) return
    setIsSearching(true)
    try {
      const response = await searchVideos(queryText, 12)
      setSearchResults(response.results)
    } catch {
      // searchVideos fallback already handles local matching
    } finally {
      setIsSearching(false)
    }
  }

  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault()
    void executeSearch(searchQuery)
  }

  function handleFindAlternatives() {
    if (!selectedBeat) return
    setActiveTab('search')
    setSearchQuery(selectedBeat.retrieval_query)
    void executeSearch(selectedBeat.retrieval_query)
  }

  if (!selectedBeat) {
    return (
      <aside className="h-full flex flex-col bg-[#121319] border-l border-[#242735] select-none p-6 items-center justify-center text-center">
        <div className="w-10 h-10 rounded-full bg-[#181a24] border border-[#242735] flex items-center justify-center text-slate-500 mb-2">
          <SlidersHorizontal className="w-5 h-5" />
        </div>
        <h4 className="text-xs font-semibold text-slate-300 mb-1">Inspector</h4>
        <p className="text-[11px] text-slate-500 max-w-xs">
          Select a beat from the script or timeline to inspect editorial intent and explore matching footage.
        </p>
      </aside>
    )
  }

  const assignedClip = selectedBeat.assigned_clip

  return (
    <aside className="h-full flex flex-col bg-[#121319] border-l border-[#242735] select-none min-h-0">
      {/* Panel Header & Tabs */}
      <div className="h-10 px-3 border-b border-[#242735] flex items-center justify-between bg-[#161820]">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-300">
          <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
          <span>Beat {selectedBeat.beat_number} Inspector</span>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-[#121319] border border-[#242735] rounded p-0.5 text-[11px]">
          <button
            onClick={() => setActiveTab('analysis')}
            className={`px-2 py-0.5 rounded transition-colors ${
              activeTab === 'analysis'
                ? 'bg-[#252836] text-blue-400 font-medium'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Editorial Intent
          </button>
          <button
            onClick={() => setActiveTab('search')}
            className={`px-2 py-0.5 rounded transition-colors ${
              activeTab === 'search'
                ? 'bg-[#252836] text-blue-400 font-medium'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            B-roll Library
          </button>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'analysis' ? (
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {/* Section: Beat Script Narration */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
              Script Narration
            </label>
            <div className="p-2.5 rounded bg-[#161820] border border-[#222532] text-slate-200 text-xs leading-relaxed italic">
              “{selectedBeat.narration}”
            </div>
          </div>

          {/* Section: Editorial Intent */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Editorial Role / Intent
              </label>
              <span className="text-[10px] text-blue-400">Dramatic Function</span>
            </div>
            <select
              value={selectedBeat.editorial_intent}
              onChange={(e) =>
                onUpdateBeatMetadata(selectedBeat.id, {
                  editorial_intent: e.target.value as EditorialIntent,
                })
              }
              className="w-full bg-[#161820] border border-[#242735] text-slate-200 rounded px-2.5 py-1.5 focus:border-blue-500 focus:outline-none capitalize"
            >
              {INTENT_OPTIONS.map((intent) => (
                <option key={intent} value={intent}>
                  {intent}
                </option>
              ))}
            </select>
          </div>

          {/* Section: Visual Role & Direction */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
              Visual Role in Sequence
            </label>
            <textarea
              rows={2}
              value={selectedBeat.visual_role}
              onChange={(e) =>
                onUpdateBeatMetadata(selectedBeat.id, {
                  visual_role: e.target.value,
                })
              }
              placeholder="What narrative role should this shot fulfill?"
              className="w-full bg-[#161820] border border-[#242735] rounded p-2 text-slate-200 focus:border-blue-500 focus:outline-none resize-none leading-snug"
            />
          </div>

          {/* Section: Visual Description */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
              Visual Description
            </label>
            <textarea
              rows={2}
              value={selectedBeat.visual_description}
              onChange={(e) =>
                onUpdateBeatMetadata(selectedBeat.id, {
                  visual_description: e.target.value,
                })
              }
              placeholder="Detailed description of the imagery..."
              className="w-full bg-[#161820] border border-[#242735] rounded p-2 text-slate-200 focus:border-blue-500 focus:outline-none resize-none leading-snug"
            />
          </div>

          {/* Section: Retrieval Query */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Retrieval Query
              </label>
              <button
                onClick={handleFindAlternatives}
                className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1"
              >
                <span>Find Matches</span>
                <ArrowRight className="w-2.5 h-2.5" />
              </button>
            </div>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={selectedBeat.retrieval_query}
                onChange={(e) =>
                  onUpdateBeatMetadata(selectedBeat.id, {
                    retrieval_query: e.target.value,
                  })
                }
                className="flex-1 bg-[#161820] border border-[#242735] rounded px-2.5 py-1 text-slate-200 focus:border-blue-500 focus:outline-none"
              />
              <button
                onClick={handleFindAlternatives}
                title="Search with this query"
                className="px-2.5 py-1 bg-[#202330] hover:bg-[#282c3c] border border-[#2a2e3d] text-slate-300 rounded"
              >
                <Search className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Section: Currently Assigned Clip */}
          <div className="pt-2 border-t border-[#202330]">
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Assigned B-roll Footage
              </label>
              {assignedClip && (
                <button
                  onClick={() => onRemoveClipFromBeat(selectedBeat.id)}
                  className="text-[10px] text-rose-400 hover:text-rose-300 flex items-center gap-1"
                >
                  <Trash2 className="w-2.5 h-2.5" />
                  <span>Remove</span>
                </button>
              )}
            </div>

            {assignedClip ? (
              <div className="bg-[#161820] border border-[#242735] rounded-md overflow-hidden">
                <div className="relative aspect-video bg-black group">
                  <img
                    src={mediaUrl(assignedClip.thumbnail_url)}
                    alt="Assigned footage"
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={() => onPreviewClip(assignedClip)}
                    className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity"
                  >
                    <Play className="w-6 h-6 fill-white" />
                  </button>
                  <span className="absolute bottom-1 right-1 bg-black/70 px-1.5 py-0.5 rounded text-[9px] text-slate-200">
                    {assignedClip.duration ? `${Math.round(assignedClip.duration)}s` : '–'}
                  </span>
                </div>

                <div className="p-2.5 space-y-1 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-200">
                      Clip #{assignedClip.video_id}
                    </span>
                    <a
                      href={assignedClip.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-slate-500 hover:text-slate-300 flex items-center gap-1 text-[10px]"
                    >
                      <span>{assignedClip.source}</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>

                  <p className="text-slate-400 truncate">
                    by {assignedClip.creator || 'Pixabay'} · {assignedClip.width}×{assignedClip.height}
                  </p>

                  <div className="flex flex-wrap gap-1 pt-1">
                    {assignedClip.tags.slice(0, 4).map((tag) => (
                      <span
                        key={tag}
                        className="bg-[#202330] text-slate-400 px-1.5 py-0.5 rounded text-[9px]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div className="pt-2 flex gap-2">
                    <button
                      onClick={handleFindAlternatives}
                      className="flex-1 py-1.5 bg-[#202330] hover:bg-[#282c3c] border border-[#2a2e3d] text-slate-200 rounded text-center font-medium transition-colors"
                    >
                      Find Alternatives
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-3 border border-dashed border-[#282c3c] rounded text-center bg-[#14161f]">
                <p className="text-[11px] text-slate-500 mb-2">No B-roll assigned yet</p>
                <button
                  onClick={handleFindAlternatives}
                  className="px-3 py-1 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-400 rounded text-[11px] font-medium transition-colors"
                >
                  Find B-roll for this beat
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Tab: B-Roll Library Search */
        <div className="flex-1 flex flex-col p-3 gap-3 min-h-0">
          <form onSubmit={handleSearchSubmit} className="flex gap-1.5">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search library: e.g. electric car charging"
              className="flex-1 bg-[#161820] border border-[#242735] focus:border-blue-500 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none"
            />
            <button
              type="submit"
              disabled={isSearching}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs transition-colors flex items-center justify-center"
            >
              {isSearching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            </button>
          </form>

          {/* Search Results Grid */}
          <div className="flex-1 overflow-y-auto grid grid-cols-2 gap-2 min-h-0 pr-1">
            {searchResults.map((result) => {
              const isAssigned = assignedClip?.video_id === result.video_id

              return (
                <div
                  key={result.video_id}
                  onMouseEnter={() => setHoveredResultId(result.video_id)}
                  onMouseLeave={() => setHoveredResultId(null)}
                  className={`group relative rounded border overflow-hidden bg-[#161820] flex flex-col transition-all ${
                    isAssigned
                      ? 'border-blue-500 shadow-md ring-1 ring-blue-500/50'
                      : 'border-[#242735] hover:border-[#383c4e]'
                  }`}
                >
                  <div className="relative aspect-video bg-black">
                    {hoveredResultId === result.video_id ? (
                      <video
                        ref={previewVideoRef}
                        src={mediaUrl(result.video_url)}
                        autoPlay
                        muted
                        loop
                        playsInline
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <img
                        src={mediaUrl(result.thumbnail_url)}
                        alt={`Clip #${result.video_id}`}
                        className="w-full h-full object-cover"
                      />
                    )}

                    <span className="absolute bottom-1 right-1 bg-black/80 px-1 py-0.5 rounded text-[9px] text-slate-200">
                      {result.duration ? `${Math.round(result.duration)}s` : '–'}
                    </span>

                    {/* Quick Preview Click */}
                    <button
                      onClick={() => onPreviewClip(result)}
                      title="Preview in main player"
                      className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity"
                    >
                      <Play className="w-5 h-5 fill-white/80" />
                    </button>
                  </div>

                  <div className="p-2 flex flex-col justify-between flex-1 gap-1.5 text-[10px]">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-200">#{result.video_id}</span>
                      <span className="text-slate-500">{(result.score * 100).toFixed(0)}%</span>
                    </div>

                    <p className="text-slate-400 truncate">
                      {result.creator || 'Pixabay'}
                    </p>

                    <button
                      onClick={() => onAssignClipToBeat(selectedBeat.id, result)}
                      className={`w-full py-1 rounded text-center font-medium transition-colors ${
                        isAssigned
                          ? 'bg-blue-600 text-white'
                          : 'bg-[#202330] hover:bg-blue-600 hover:text-white text-slate-300'
                      }`}
                    >
                      {isAssigned ? 'Assigned' : 'Assign to Beat'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </aside>
  )
}
