import { useState, useRef, useEffect } from 'react'
import {
  Film,
  Undo2,
  Redo2,
  LayoutGrid,
  Columns3,
  Sparkles,
  Server,
  FileText,
  ChevronDown,
  RefreshCw,
} from 'lucide-react'
import { SAMPLE_SCRIPTS } from '../../data/libraryData'
import type { HealthResult } from '../../api/client'

interface TopBarProps {
  projectTitle: string
  onTitleChange: (newTitle: string) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  viewMode: 'timeline' | 'storyboard'
  onViewModeChange: (mode: 'timeline' | 'storyboard') => void
  isGenerating: boolean
  onGenerateSequence: () => void
  onLoadSample: (sampleId: string) => void
  onOpenHealth: () => void
  healthSummary: HealthResult | null
  beatCount: number
  assignedCount: number
  onReplayIntro?: () => void
}

export default function TopBar({
  projectTitle,
  onTitleChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  viewMode,
  onViewModeChange,
  isGenerating,
  onGenerateSequence,
  onLoadSample,
  onOpenHealth,
  healthSummary,
  beatCount,
  assignedCount,
  onReplayIntro,
}: TopBarProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [tempTitle, setTempTitle] = useState(projectTitle)
  const [showSamples, setShowSamples] = useState(false)
  const samplesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setTempTitle(projectTitle)
  }, [projectTitle])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (samplesRef.current && !samplesRef.current.contains(e.target as Node)) {
        setShowSamples(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function commitTitle() {
    setIsEditingTitle(false)
    if (tempTitle.trim()) {
      onTitleChange(tempTitle.trim())
    } else {
      setTempTitle(projectTitle)
    }
  }

  const isHealthy = healthSummary?.status === 'ok'
  const isWarning = healthSummary?.status === 'not_configured'
  const isError = healthSummary?.status === 'error' || healthSummary?.status === 'unreachable'

  return (
    <header className="h-12 border-b border-[#242735] bg-[#121319] px-4 flex items-center justify-between select-none">
      {/* Left: Brand & Project Name */}
      <div className="flex items-center gap-4 min-w-0">
        <button
          onClick={onReplayIntro}
          title="Replay Studio Intro"
          className="flex items-center gap-2 text-slate-200 hover:text-white group transition-colors"
        >
          <div className="w-7 h-7 rounded bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400 group-hover:bg-blue-600/30 group-hover:scale-105 transition-all">
            <Film className="w-4 h-4" />
          </div>
          <span className="font-semibold text-sm tracking-tight text-slate-100 hidden sm:inline">
            Script2Broll
          </span>
          <span className="text-xs text-[#5e6475] hidden md:inline">|</span>
        </button>

        {/* Project Title Editor */}
        <div className="flex items-center gap-2 min-w-0">
          {isEditingTitle ? (
            <input
              type="text"
              value={tempTitle}
              autoFocus
              onChange={(e) => setTempTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitTitle()
                if (e.key === 'Escape') {
                  setTempTitle(projectTitle)
                  setIsEditingTitle(false)
                }
              }}
              className="bg-[#181a23] border border-blue-500/50 rounded px-2 py-0.5 text-xs text-slate-200 focus:outline-none w-64"
            />
          ) : (
            <button
              onClick={() => setIsEditingTitle(true)}
              title="Click to rename project"
              className="text-xs font-medium text-slate-300 hover:text-white truncate max-w-[200px] lg:max-w-xs px-2 py-1 rounded hover:bg-[#1c1e28] transition-colors text-left"
            >
              {projectTitle}
            </button>
          )}

          {beatCount > 0 && (
            <span className="text-[11px] text-[#8e95a5] bg-[#1c1e28] border border-[#242735] px-2 py-0.5 rounded-full hidden sm:inline">
              {assignedCount}/{beatCount} beats assigned
            </span>
          )}
        </div>
      </div>

      {/* Center: Workspace View Switcher & Undo/Redo */}
      <div className="flex items-center gap-2">
        <div className="flex items-center border border-[#242735] bg-[#161820] rounded p-0.5">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-[#20232e] disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (Ctrl+Y)"
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-[#20232e] disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="h-4 w-[1px] bg-[#242735] mx-1" />

        {/* View Mode Switcher */}
        <div className="flex items-center bg-[#161820] border border-[#242735] rounded p-0.5 text-xs">
          <button
            onClick={() => onViewModeChange('timeline')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors ${
              viewMode === 'timeline'
                ? 'bg-[#252836] text-blue-400 font-medium'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Columns3 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Editor Timeline</span>
          </button>
          <button
            onClick={() => onViewModeChange('storyboard')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors ${
              viewMode === 'storyboard'
                ? 'bg-[#252836] text-blue-400 font-medium'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Storyboard</span>
          </button>
        </div>
      </div>

      {/* Right: Master Actions & System Status */}
      <div className="flex items-center gap-3">
        {/* Sample Scripts Dropdown */}
        <div className="relative" ref={samplesRef}>
          <button
            onClick={() => setShowSamples(!showSamples)}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-slate-300 hover:text-white bg-[#161820] hover:bg-[#1c1e28] border border-[#242735] rounded transition-colors"
          >
            <FileText className="w-3.5 h-3.5 text-slate-400" />
            <span className="hidden md:inline">Sample Scripts</span>
            <ChevronDown className="w-3 h-3 text-slate-500" />
          </button>

          {showSamples && (
            <div className="absolute right-0 mt-1 w-72 bg-[#161820] border border-[#282c3c] rounded-md shadow-xl py-1 z-50">
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#5e6475] border-b border-[#242735]">
                Production Test Scripts
              </div>
              {SAMPLE_SCRIPTS.map((sample) => (
                <button
                  key={sample.id}
                  onClick={() => {
                    onLoadSample(sample.id)
                    setShowSamples(false)
                  }}
                  className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-[#1f222e] hover:text-white flex flex-col gap-0.5 transition-colors border-b border-[#1c1e28] last:border-b-0"
                >
                  <span className="font-medium text-slate-200">{sample.title}</span>
                  <span className="text-[10px] text-slate-500">{sample.category} · {sample.suggestedBeats.length} beats</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Master Action: Generate B-roll / Sequence */}
        <button
          onClick={onGenerateSequence}
          disabled={isGenerating || beatCount === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600 rounded transition-colors shadow-sm"
        >
          {isGenerating ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Generating…</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" />
              <span>Generate B-roll</span>
            </>
          )}
        </button>

        {/* Backend Connectivity Status Pill */}
        <button
          onClick={onOpenHealth}
          title="Service Health & Diagnostic Status"
          className="flex items-center gap-1.5 px-2 py-1 text-[11px] rounded bg-[#161820] hover:bg-[#1c1e28] border border-[#242735] text-slate-400 hover:text-slate-200 transition-colors"
        >
          <span
            className={`w-2 h-2 rounded-full ${
              isHealthy
                ? 'bg-emerald-500'
                : isWarning
                ? 'bg-amber-500'
                : isError
                ? 'bg-rose-500'
                : 'bg-slate-500'
            }`}
          />
          <Server className="w-3 h-3 text-slate-400 hidden sm:inline" />
          <span className="hidden lg:inline">
            {isHealthy ? 'Backend OK' : isError ? 'Offline' : 'Status'}
          </span>
        </button>
      </div>
    </header>
  )
}
