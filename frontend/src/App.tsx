import { useState, useEffect } from 'react'
import Navbar, { type NavTab } from './components/navigation/Navbar'
import ScriptToBeatView from './components/views/ScriptToBeatView'
import SemanticSearchView from './components/views/SemanticSearchView'
import CinematicIntro from './components/intro/CinematicIntro'
import HealthModal from './components/modals/HealthModal'
import { SAMPLE_SCRIPTS } from './data/libraryData'
import { analyzeScript, beatToScriptBeat, getHealth, SearchError, transcribeAudio, type HealthResult } from './api/client'
import type { Project, ScriptBeat, BrollClip } from './types/editor'

// Per beat: 3 local library clips + 2 cloud clips. If no cloud provider is enabled on the backend
// (CLOUD_PROVIDERS), the backend reports it as disabled and fills those slots with local clips.
const SCRIPT_RETRIEVAL = { local_k: 3, cloud_k: 2, cloud_providers: ['pixabay'], fill: 'backfill' as const }

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

  // Start with a sample script; beats come only from the backend (POST /v1/script/analyze).
  const initialSample = SAMPLE_SCRIPTS[0]

  const [project, setProject] = useState<Project>({
    id: 'prj-ev-01',
    title: initialSample.title,
    raw_script: initialSample.script,
    beats: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })

  const [selectedBeatId, setSelectedBeatId] = useState<string | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [analyzeNote, setAnalyzeNote] = useState<string | null>(null)

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

  // Audio narration -> backend transcription -> the same Script -> Beat analysis as typed text.
  async function handleAudioUpload(file: File) {
    if (isAnalyzing) return
    setIsAnalyzing(true)
    setAnalyzeError(null)
    setAnalyzeNote(`Transcribing ${file.name}…`)
    try {
      const transcript = await transcribeAudio(file)
      setProject((prev) => ({ ...prev, raw_script: transcript.text, beats: [], updated_at: new Date().toISOString() }))
      setAnalyzeNote(`Transcribed ${transcript.duration?.toFixed(0) ?? '?'}s of audio (${transcript.language ?? 'unknown language'}, Whisper ${transcript.model}). Analysing…`)
      setIsAnalyzing(false)
      await handleAnalyzeScript(transcript.text)
    } catch (error) {
      setAnalyzeNote(null)
      setAnalyzeError(error instanceof SearchError ? error.message : 'Audio transcription failed.')
      setIsAnalyzing(false)
    }
  }

  async function handleAnalyzeScript(scriptOverride?: string) {
    const scriptText = scriptOverride ?? project.raw_script
    if (!scriptText.trim()) return
    setIsAnalyzing(true)
    setAnalyzeError(null)
    setAnalyzeNote(null)
    try {
      const response = await analyzeScript(scriptText, { retrieval: SCRIPT_RETRIEVAL })
      const beats: ScriptBeat[] = response.beats.map(beatToScriptBeat)
      setProject((prev) => ({ ...prev, beats, updated_at: new Date().toISOString() }))
      setSelectedBeatId(beats[0]?.id ?? null)
      const notes: string[] = []
      if (response.segmentation.method === 'sentence_fallback') {
        notes.push(`Beat grouping fell back to one beat per sentence (${response.segmentation.error ?? 'invalid model output'}).`)
      }
      const failed = beats.filter((b) => b.status === 'error').length
      if (failed) notes.push(`${failed} beat(s) could not be analysed; the others are shown.`)
      const cloudIssues = new Set(
        beats.flatMap((b) =>
          Object.entries(b.source_status ?? {})
            .filter(([name, st]) => name !== 'local' && st.status !== 'ok')
            .map(([name, st]) => `${name}: ${st.detail ?? st.status}`),
        ),
      )
      if (cloudIssues.size) notes.push(`Cloud results unavailable — ${[...cloudIssues].join('; ')}. Local results are shown.`)
      if (beats.length === 0) notes.push('The backend returned no beats for this script.')
      setAnalyzeNote(notes.length ? notes.join(' ') : null)
    } catch (error) {
      setAnalyzeError(error instanceof SearchError ? error.message : 'Script analysis failed.')
    } finally {
      setIsAnalyzing(false)
    }
  }

  function handleLoadSample(sampleId: string) {
    const sample = SAMPLE_SCRIPTS.find((s) => s.id === sampleId)
    if (!sample) return
    // Only the script text is used; beats and footage come from the backend when analysed.
    setProject({
      id: `prj-${sample.id}`,
      title: sample.title,
      raw_script: sample.script,
      beats: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    setSelectedBeatId(null)
    setAnalyzeError(null)
    setAnalyzeNote(null)
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
            onAnalyzeScript={() => void handleAnalyzeScript()}
            beats={project.beats}
            selectedBeatId={selectedBeatId}
            onSelectBeat={setSelectedBeatId}
            onAssignClipToBeat={handleAssignClipToBeat}
            isAnalyzing={isAnalyzing}
            onLoadSample={handleLoadSample}
            analyzeError={analyzeError}
            onAudioUpload={(file) => void handleAudioUpload(file)}
            analyzeNote={analyzeNote}
          />
        )}

        {activeTab === 'semantic_search' && <SemanticSearchView />}
      </main>

      {/* Service Diagnostics Modal */}
      <HealthModal isOpen={isHealthOpen} onClose={() => setIsHealthOpen(false)} />

      {/* 2-3s Cinematic Studio Intro on every refresh / restart */}
      {showIntro && <CinematicIntro onComplete={() => setShowIntro(false)} />}
    </div>
  )
}
