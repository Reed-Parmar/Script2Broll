import { useState, useEffect, useCallback } from 'react'
import TopBar from './components/layout/TopBar'
import ScriptPanel from './components/script/ScriptPanel'
import VideoPlayer from './components/player/VideoPlayer'
import InspectorPanel from './components/inspector/InspectorPanel'
import Timeline from './components/timeline/Timeline'
import Storyboard from './components/timeline/Storyboard'
import GenerationModal from './components/modals/GenerationModal'
import HealthModal from './components/modals/HealthModal'
import { SAMPLE_SCRIPTS, LOCAL_LIBRARY_CLIPS } from './data/libraryData'
import { analyzeScriptToBeats } from './utils/editorialAnalysis'
import { getHealth, searchVideos, type HealthResult } from './api/client'
import type { Project, ScriptBeat, BrollClip, GenerationStage } from './types/editor'

export default function App() {
  // Initialize with the Electric Vehicle sample project loaded with curated B-roll
  const initialSample = SAMPLE_SCRIPTS[0]
  const initialBeats: ScriptBeat[] = initialSample.suggestedBeats.map((b, i) => {
    // Map initial clips from our 42 local library videos
    const clipMapping = [
      LOCAL_LIBRARY_CLIPS[26], // #27: EV charging
      LOCAL_LIBRARY_CLIPS[16], // #17: City traffic night
      LOCAL_LIBRARY_CLIPS[12], // #13: EV charging plug
      LOCAL_LIBRARY_CLIPS[18], // #19: Meeting planning
      LOCAL_LIBRARY_CLIPS[29], // #30: EV solar energy
    ]

    return {
      ...b,
      id: `beat-${b.beat_number}-init`,
      assigned_clip: clipMapping[i] || LOCAL_LIBRARY_CLIPS[i % LOCAL_LIBRARY_CLIPS.length],
      status: 'assigned',
    }
  })

  const [project, setProject] = useState<Project>({
    id: 'prj-ev-01',
    title: initialSample.title,
    raw_script: initialSample.script,
    beats: initialBeats,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })

  // History stack for Undo / Redo
  const [history, setHistory] = useState<Project[]>([])
  const [future, setFuture] = useState<Project[]>([])

  // Editor Workspace State
  const [selectedBeatId, setSelectedBeatId] = useState<string | null>(initialBeats[0]?.id || null)
  const [viewMode, setViewMode] = useState<'timeline' | 'storyboard'>('timeline')

  // Playback State
  const [playbackMode, setPlaybackMode] = useState<'clip' | 'sequence'>('clip')
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)

  // Generation Modal State
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationStage, setGenerationStage] = useState<GenerationStage>('idle')
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [showGenModal, setShowGenModal] = useState(false)

  // Diagnostics State
  const [isHealthOpen, setIsHealthOpen] = useState(false)
  const [healthSummary, setHealthSummary] = useState<HealthResult | null>(null)

  // Calculate total duration across all beats
  const totalDuration = project.beats.reduce((acc, b) => {
    const dur = b.assigned_clip?.duration || b.target_duration
    return acc + dur
  }, 0)

  const selectedBeat = project.beats.find((b) => b.id === selectedBeatId) || project.beats[0] || null

  // Check backend health on mount
  useEffect(() => {
    getHealth('/health').then((res) => setHealthSummary(res))
  }, [])

  // Helper to commit project mutations into undo history
  const updateProject = useCallback(
    (mutator: (prev: Project) => Project) => {
      setProject((current) => {
        const next = mutator(current)
        setHistory((prevHistory) => [...prevHistory.slice(-20), current])
        setFuture([])
        return next
      })
    },
    []
  )

  function handleUndo() {
    if (history.length === 0) return
    const prev = history[history.length - 1]
    setHistory((h) => h.slice(0, -1))
    setFuture((f) => [project, ...f])
    setProject(prev)
  }

  function handleRedo() {
    if (future.length === 0) return
    const next = future[0]
    setFuture((f) => f.slice(1))
    setHistory((h) => [...h, project])
    setProject(next)
  }

  // Keyboard Shortcuts (Space for Play/Pause, Ctrl+Z, Ctrl+Y)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't intercept when user is typing in text inputs or textareas
      const tag = (e.target as HTMLElement).tagName.toLowerCase()
      if (tag === 'input' || tag === 'textarea') return

      if (e.code === 'Space') {
        e.preventDefault()
        setIsPlaying((prev) => !prev)
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault()
        setCurrentTime((t) => Math.max(0, t - 1.0))
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        setCurrentTime((t) => Math.min(totalDuration, t + 1.0))
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) {
          handleRedo()
        } else {
          handleUndo()
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        handleRedo()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [totalDuration, history.length, future.length])

  // Script changes
  function handleScriptChange(text: string) {
    updateProject((prev) => ({
      ...prev,
      raw_script: text,
      updated_at: new Date().toISOString(),
    }))
  }

  // Break raw script into editorial beats
  function handleAnalyzeScript() {
    const raw = project.raw_script.trim()
    if (!raw) return

    const newBeats = analyzeScriptToBeats(raw)
    updateProject((prev) => ({
      ...prev,
      beats: newBeats,
      updated_at: new Date().toISOString(),
    }))

    if (newBeats.length > 0) {
      setSelectedBeatId(newBeats[0].id)
    }
  }

  // Load sample scripts
  function handleLoadSample(sampleId: string) {
    const sample = SAMPLE_SCRIPTS.find((s) => s.id === sampleId)
    if (!sample) return

    const beats: ScriptBeat[] = sample.suggestedBeats.map((b, i) => {
      // Intelligently pair with sample clips from library
      let clip = LOCAL_LIBRARY_CLIPS[i % LOCAL_LIBRARY_CLIPS.length]
      if (sampleId === 'ev-infrastructure') {
        const evClips = [LOCAL_LIBRARY_CLIPS[26], LOCAL_LIBRARY_CLIPS[16], LOCAL_LIBRARY_CLIPS[12], LOCAL_LIBRARY_CLIPS[18], LOCAL_LIBRARY_CLIPS[29]]
        clip = evClips[i] || clip
      } else if (sampleId === 'ai-medicine') {
        const medClips = [LOCAL_LIBRARY_CLIPS[7], LOCAL_LIBRARY_CLIPS[35], LOCAL_LIBRARY_CLIPS[34], LOCAL_LIBRARY_CLIPS[8], LOCAL_LIBRARY_CLIPS[31]]
        clip = medClips[i] || clip
      } else if (sampleId === 'global-finance') {
        const finClips = [LOCAL_LIBRARY_CLIPS[14], LOCAL_LIBRARY_CLIPS[32], LOCAL_LIBRARY_CLIPS[1], LOCAL_LIBRARY_CLIPS[41], LOCAL_LIBRARY_CLIPS[37]]
        clip = finClips[i] || clip
      }

      return {
        ...b,
        id: `beat-${b.beat_number}-${Date.now().toString(36)}`,
        assigned_clip: clip,
        status: 'assigned',
      }
    })

    updateProject(() => ({
      id: `prj-${sample.id}`,
      title: sample.title,
      raw_script: sample.script,
      beats,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }))

    setSelectedBeatId(beats[0]?.id || null)
    setCurrentTime(0)
    setIsPlaying(false)
  }

  // Master Action: Full Automatic B-Roll Generation for All Beats
  async function handleGenerateSequence() {
    let currentBeats = project.beats
    if (currentBeats.length === 0 && project.raw_script.trim()) {
      currentBeats = analyzeScriptToBeats(project.raw_script)
    }

    if (currentBeats.length === 0) return

    setIsGenerating(true)
    setShowGenModal(true)
    setGenerationError(null)

    try {
      // Step 1: Parsing
      setGenerationStage('parsing')
      await new Promise((r) => setTimeout(r, 400))

      // Step 2: Beats segmentation
      setGenerationStage('beats')
      await new Promise((r) => setTimeout(r, 450))

      // Step 3: Visual intent formulation
      setGenerationStage('visual_intent')
      await new Promise((r) => setTimeout(r, 500))

      // Step 4: Retrieving footage from library
      setGenerationStage('retrieving')
      const updatedBeats: ScriptBeat[] = []

      for (let i = 0; i < currentBeats.length; i++) {
        const beat = currentBeats[i]
        try {
          const resp = await searchVideos(beat.retrieval_query, 6)
          const matchedClip = resp.results[0] || LOCAL_LIBRARY_CLIPS[i % LOCAL_LIBRARY_CLIPS.length]

          updatedBeats.push({
            ...beat,
            assigned_clip: matchedClip,
            status: 'assigned',
          })
        } catch {
          // Fallback to local clip
          updatedBeats.push({
            ...beat,
            assigned_clip: LOCAL_LIBRARY_CLIPS[i % LOCAL_LIBRARY_CLIPS.length],
            status: 'assigned',
          })
        }
      }

      // Step 5: Assembling timeline
      setGenerationStage('assembling')
      await new Promise((r) => setTimeout(r, 450))

      updateProject((prev) => ({
        ...prev,
        beats: updatedBeats,
        updated_at: new Date().toISOString(),
      }))

      setGenerationStage('done')
    } catch (err) {
      setGenerationStage('error')
      setGenerationError(err instanceof Error ? err.message : 'Generation failed.')
    } finally {
      setIsGenerating(false)
    }
  }

  // Beat management
  function handleAddBeat() {
    const newNum = project.beats.length + 1
    const newBeat: ScriptBeat = {
      id: `beat-${newNum}-${Date.now().toString(36)}`,
      beat_number: newNum,
      narration: `Narrative beat ${newNum} continuation...`,
      editorial_intent: 'context',
      visual_role: 'Provide supporting visual context.',
      visual_description: 'Visual footage matching narrative context.',
      retrieval_query: 'technology business urban city',
      assigned_clip: null,
      target_duration: 6.0,
      status: 'analyzed',
    }

    updateProject((prev) => ({
      ...prev,
      beats: [...prev.beats, newBeat],
      updated_at: new Date().toISOString(),
    }))

    setSelectedBeatId(newBeat.id)
  }

  function handleDeleteBeat(beatId: string) {
    updateProject((prev) => {
      const filtered = prev.beats
        .filter((b) => b.id !== beatId)
        .map((b, idx) => ({ ...b, beat_number: idx + 1 }))
      return {
        ...prev,
        beats: filtered,
        updated_at: new Date().toISOString(),
      }
    })

    if (selectedBeatId === beatId) {
      const remaining = project.beats.filter((b) => b.id !== beatId)
      setSelectedBeatId(remaining[0]?.id || null)
    }
  }

  function handleReorderBeats(sourceIndex: number, targetIndex: number) {
    if (sourceIndex === targetIndex || targetIndex < 0 || targetIndex >= project.beats.length) return

    updateProject((prev) => {
      const copy = [...prev.beats]
      const [moved] = copy.splice(sourceIndex, 1)
      copy.splice(targetIndex, 0, moved)
      const renumbered = copy.map((b, i) => ({ ...b, beat_number: i + 1 }))
      return {
        ...prev,
        beats: renumbered,
        updated_at: new Date().toISOString(),
      }
    })
  }

  function handleAssignClipToBeat(beatId: string, clip: BrollClip) {
    updateProject((prev) => ({
      ...prev,
      beats: prev.beats.map((b) =>
        b.id === beatId ? { ...b, assigned_clip: clip, status: 'assigned' } : b
      ),
      updated_at: new Date().toISOString(),
    }))
  }

  function handleRemoveClipFromBeat(beatId: string) {
    updateProject((prev) => ({
      ...prev,
      beats: prev.beats.map((b) =>
        b.id === beatId ? { ...b, assigned_clip: null, status: 'analyzed' } : b
      ),
      updated_at: new Date().toISOString(),
    }))
  }

  function handleUpdateBeatMetadata(
    beatId: string,
    updates: Partial<Pick<ScriptBeat, 'editorial_intent' | 'visual_role' | 'visual_description' | 'retrieval_query'>>
  ) {
    updateProject((prev) => ({
      ...prev,
      beats: prev.beats.map((b) => (b.id === beatId ? { ...b, ...updates } : b)),
      updated_at: new Date().toISOString(),
    }))
  }

  function handlePreviewClip(clip: BrollClip) {
    if (selectedBeatId) {
      handleAssignClipToBeat(selectedBeatId, clip)
    }
    setCurrentTime(0)
    setIsPlaying(true)
  }

  const assignedCount = project.beats.filter((b) => b.assigned_clip !== null).length

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0b0c10] text-[#ededf2] overflow-hidden">
      {/* Top Application Bar */}
      <TopBar
        projectTitle={project.title}
        onTitleChange={(title) => updateProject((p) => ({ ...p, title }))}
        canUndo={history.length > 0}
        canRedo={future.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        isGenerating={isGenerating}
        onGenerateSequence={handleGenerateSequence}
        onLoadSample={handleLoadSample}
        onOpenHealth={() => setIsHealthOpen(true)}
        healthSummary={healthSummary}
        beatCount={project.beats.length}
        assignedCount={assignedCount}
      />

      {/* Main Workspace (3-Column Layout: Left Script, Center Player, Right Inspector) */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Left Column: Script & Beats (Source of Truth) */}
        <div className="w-72 lg:w-80 shrink-0 h-full">
          <ScriptPanel
            scriptText={project.raw_script}
            onScriptChange={handleScriptChange}
            onAnalyzeScript={handleAnalyzeScript}
            beats={project.beats}
            selectedBeatId={selectedBeatId}
            onSelectBeat={(id) => {
              setSelectedBeatId(id)
              setCurrentTime(0)
            }}
            onAddBeat={handleAddBeat}
            onDeleteBeat={handleDeleteBeat}
            onFindBrollForBeat={(id) => {
              setSelectedBeatId(id)
            }}
            isAnalyzing={isGenerating}
          />
        </div>

        {/* Center Column: Video Player Viewport */}
        <div className="flex-1 h-full min-w-0 flex flex-col">
          <VideoPlayer
            activeBeat={selectedBeat}
            allBeats={project.beats}
            playbackMode={playbackMode}
            onPlaybackModeChange={setPlaybackMode}
            onFindBroll={(id) => setSelectedBeatId(id)}
            currentTime={currentTime}
            totalDuration={totalDuration}
            onSeek={setCurrentTime}
            isPlaying={isPlaying}
            onTogglePlay={() => setIsPlaying((p) => !p)}
          />
        </div>

        {/* Right Column: AI Analysis & B-Roll Inspector */}
        <div className="w-80 lg:w-96 shrink-0 h-full">
          <InspectorPanel
            selectedBeat={selectedBeat}
            onUpdateBeatMetadata={handleUpdateBeatMetadata}
            onAssignClipToBeat={handleAssignClipToBeat}
            onRemoveClipFromBeat={handleRemoveClipFromBeat}
            onPreviewClip={handlePreviewClip}
          />
        </div>
      </div>

      {/* Bottom Workspace: Timeline or Storyboard Sequence */}
      {viewMode === 'timeline' ? (
        <Timeline
          beats={project.beats}
          selectedBeatId={selectedBeatId}
          onSelectBeat={(id) => {
            setSelectedBeatId(id)
            // compute start time for this beat
            let offset = 0
            for (const b of project.beats) {
              if (b.id === id) break
              offset += b.assigned_clip?.duration || b.target_duration
            }
            setCurrentTime(offset)
          }}
          onReorderBeats={handleReorderBeats}
          onRemoveClip={handleRemoveClipFromBeat}
          onFindAlternatives={(id) => setSelectedBeatId(id)}
          currentTime={currentTime}
          totalDuration={totalDuration}
          onSeek={setCurrentTime}
          onPreviewClip={handlePreviewClip}
        />
      ) : (
        <Storyboard
          beats={project.beats}
          selectedBeatId={selectedBeatId}
          onSelectBeat={(id) => setSelectedBeatId(id)}
          onReorderBeats={handleReorderBeats}
          onRemoveClip={handleRemoveClipFromBeat}
          onFindAlternatives={(id) => setSelectedBeatId(id)}
          onPreviewClip={handlePreviewClip}
        />
      )}

      {/* Generation Progress Modal */}
      <GenerationModal
        isOpen={showGenModal}
        stage={generationStage}
        error={generationError}
        onClose={() => setShowGenModal(false)}
      />

      {/* Service Diagnostics Modal */}
      <HealthModal
        isOpen={isHealthOpen}
        onClose={() => setIsHealthOpen(false)}
      />
    </div>
  )
}
