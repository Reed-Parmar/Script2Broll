import { useState, useEffect } from 'react'
import Navbar, { type NavTab } from './components/navigation/Navbar'
import ScriptToBeatView from './components/views/ScriptToBeatView'
import SemanticSearchView from './components/views/SemanticSearchView'
import EditorialSearchView from './components/views/EditorialSearchView'
import CinematicIntro from './components/intro/CinematicIntro'
import HealthModal from './components/modals/HealthModal'
import { SAMPLE_SCRIPTS, LOCAL_LIBRARY_CLIPS } from './data/libraryData'
import { analyzeScriptToBeats } from './utils/editorialAnalysis'
import { getHealth, type HealthResult } from './api/client'
import type { Project, ScriptBeat, BrollClip } from './types/editor'

export default function App() {
  // Navigation Tab State
  const [activeTab, setActiveTab] = useState<NavTab>('script_to_beat')

  // Theme State: 'dark' | 'light' (defaults to 'dark', persists in localStorage)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('script2broll-theme') as 'dark' | 'light') || 'dark'
  })

  // Cinematic Intro: Plays on every refresh/restart (as requested)
  const [showIntro, setShowIntro] = useState(true)

  // Health Diagnostics
  const [isHealthOpen, setIsHealthOpen] = useState(false)
  const [healthSummary, setHealthSummary] = useState<HealthResult | null>(null)

  // Initialize with curated EV Infrastructure sample
  const initialSample = SAMPLE_SCRIPTS[0]
  const initialBeats: ScriptBeat[] = initialSample.suggestedBeats.map((b, i) => {
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

  const [selectedBeatId, setSelectedBeatId] = useState<string | null>(initialBeats[0]?.id || null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  // Synchronize theme with document element
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
      root.classList.remove('light')
    } else {
      root.classList.add('light')
      root.classList.remove('dark')
    }
    localStorage.setItem('script2broll-theme', theme)
  }, [theme])

  // Check backend health on mount
  useEffect(() => {
    getHealth('/health').then((res) => setHealthSummary(res))
  }, [])

  function toggleTheme() {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }

  // Script & Beat Handlers
  function handleScriptChange(text: string) {
    setProject((prev) => ({
      ...prev,
      raw_script: text,
      updated_at: new Date().toISOString(),
    }))
  }

  function handleAnalyzeScript() {
    if (!project.raw_script.trim()) return
    setIsAnalyzing(true)

    setTimeout(() => {
      const generatedBeats = analyzeScriptToBeats(project.raw_script)
      // Automatically assign initial visual matches from library
      const beatsWithClips: ScriptBeat[] = generatedBeats.map((b, idx) => ({
        ...b,
        assigned_clip: LOCAL_LIBRARY_CLIPS[idx % LOCAL_LIBRARY_CLIPS.length],
        status: 'assigned',
      }))

      setProject((prev) => ({
        ...prev,
        beats: beatsWithClips,
        updated_at: new Date().toISOString(),
      }))

      if (beatsWithClips.length > 0) {
        setSelectedBeatId(beatsWithClips[0].id)
      }
      setIsAnalyzing(false)
    }, 400)
  }

  function handleLoadSample(sampleId: string) {
    const sample = SAMPLE_SCRIPTS.find((s) => s.id === sampleId)
    if (!sample) return

    const beats: ScriptBeat[] = sample.suggestedBeats.map((b, i) => {
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

    setProject({
      id: `prj-${sample.id}`,
      title: sample.title,
      raw_script: sample.script,
      beats,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    setSelectedBeatId(beats[0]?.id || null)
  }

  function handleAssignClipToBeat(beatId: string, clip: BrollClip) {
    setProject((prev) => ({
      ...prev,
      beats: prev.beats.map((b) => (b.id === beatId ? { ...b, assigned_clip: clip, status: 'assigned' } : b)),
      updated_at: new Date().toISOString(),
    }))
  }

  return (
    <div className="min-h-screen w-screen flex flex-col bg-[var(--bg-app)] text-[var(--text-primary)] transition-colors duration-200">
      {/* Top Navbar */}
      <Navbar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenHealth={() => setIsHealthOpen(true)}
        healthSummary={healthSummary}
        onReplayIntro={() => setShowIntro(true)}
      />

      {/* Main Content Area based on Selected Tab */}
      <main className="flex-1 flex flex-col min-h-0">
        {activeTab === 'script_to_beat' && (
          <ScriptToBeatView
            scriptText={project.raw_script}
            onScriptChange={handleScriptChange}
            onAnalyzeScript={handleAnalyzeScript}
            beats={project.beats}
            selectedBeatId={selectedBeatId}
            onSelectBeat={setSelectedBeatId}
            onAssignClipToBeat={handleAssignClipToBeat}
            isAnalyzing={isAnalyzing}
            onLoadSample={handleLoadSample}
          />
        )}

        {activeTab === 'semantic_search' && <SemanticSearchView />}

        {activeTab === 'editorial_search' && <EditorialSearchView />}
      </main>

      {/* Service Diagnostics Modal */}
      <HealthModal isOpen={isHealthOpen} onClose={() => setIsHealthOpen(false)} />

      {/* 2-3s Cinematic Studio Intro on every refresh / restart */}
      {showIntro && <CinematicIntro onComplete={() => setShowIntro(false)} />}
    </div>
  )
}
