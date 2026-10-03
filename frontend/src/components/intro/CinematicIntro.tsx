import { useEffect, useState } from 'react'
import { Film, Sparkles, Layers, Cpu, Database } from 'lucide-react'
import { LOCAL_LIBRARY_CLIPS } from '../../data/libraryData'
import { mediaUrl } from '../../api/client'

interface CinematicIntroProps {
  onComplete: () => void
}

export default function CinematicIntro({ onComplete }: CinematicIntroProps) {
  const [phase, setPhase] = useState<'calibrate' | 'reveal' | 'ready' | 'exit'>('calibrate')
  const [progress, setProgress] = useState(0)
  const [timecodeFrame, setTimecodeFrame] = useState(0)
  const [activeStepIndex, setActiveStepIndex] = useState(0)

  // Curated showcase clips from our 42 library videos to show in the intro's visual reel rack
  const previewClips = [
    LOCAL_LIBRARY_CLIPS[26], // #27: EV charging
    LOCAL_LIBRARY_CLIPS[16], // #17: Seoul traffic
    LOCAL_LIBRARY_CLIPS[12], // #13: Charging plug
    LOCAL_LIBRARY_CLIPS[29], // #30: Solar energy
    LOCAL_LIBRARY_CLIPS[7],  // #8: AI circuit
    LOCAL_LIBRARY_CLIPS[18], // #19: Strategy meeting
  ]

  const workflowSteps = [
    { title: 'SCRIPT INGESTION', desc: 'Parsing narrative semantics and dialogue pacing' },
    { title: 'EDITORIAL DECOMPOSITION', desc: 'Segmenting narrative beats by dramatic intent' },
    { title: 'VISUAL INTENT SYNTHESIS', desc: 'Formulating cinematic search directions' },
    { title: 'B-ROLL RETRIEVAL', desc: 'Matching against 42 high-definition stock reels' },
    { title: 'TIMELINE SEQUENCING', desc: 'Calibrating multi-track editorial timeline' },
  ]

  useEffect(() => {
    // 0ms - 800ms: Phase 1 (Calibration)
    const t1 = setTimeout(() => {
      setPhase('reveal')
      setActiveStepIndex(2)
    }, 800)

    // 800ms - 1900ms: Phase 2 (Reveal and asset linking)
    const t2 = setTimeout(() => {
      setPhase('ready')
      setActiveStepIndex(4)
    }, 1900)

    // 2400ms: Begin exit transition
    const t3 = setTimeout(() => {
      setPhase('exit')
    }, 2400)

    // 2850ms: Unmount
    const t4 = setTimeout(() => {
      onComplete()
    }, 2850)

    // Running SMPTE timecode simulation
    const tcInterval = setInterval(() => {
      setTimecodeFrame((f) => (f + 1) % 72)
    }, 40)

    // Progress bar animation
    const start = performance.now()
    const duration = 2400

    let animId: number
    const updateProgress = () => {
      const elapsed = performance.now() - start
      const pct = Math.min(100, Math.round((elapsed / duration) * 100))
      setProgress(pct)
      if (pct > 25 && pct <= 50) setActiveStepIndex(1)
      else if (pct > 50 && pct <= 75) setActiveStepIndex(2)
      else if (pct > 75 && pct < 100) setActiveStepIndex(3)
      else if (pct >= 100) setActiveStepIndex(4)

      if (elapsed < duration) {
        animId = requestAnimationFrame(updateProgress)
      }
    }
    animId = requestAnimationFrame(updateProgress)

    // ESC or Space to skip immediately
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === ' ') {
        onComplete()
      }
    }
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
      clearTimeout(t4)
      clearInterval(tcInterval)
      cancelAnimationFrame(animId)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onComplete])

  const seconds = Math.floor(timecodeFrame / 24)
  const frames = timecodeFrame % 24
  const smpte = `00:00:0${seconds}:${String(frames).padStart(2, '0')}`

  return (
    <div
      onClick={onComplete}
      className={`fixed inset-0 z-[100] flex flex-col justify-between bg-[#06070a] select-none cursor-pointer overflow-hidden transition-all duration-500 ease-out ${
        phase === 'exit'
          ? 'opacity-0 scale-[1.02] pointer-events-none'
          : 'opacity-100 scale-100'
      }`}
    >
      {/* Background Cinematic Atmosphere */}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_50%_40%,rgba(59,130,246,0.14)_0%,rgba(6,7,10,0.95)_75%)]" />
      
      {/* Precision Blueprint Grid overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.14]"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(255, 255, 255, 0.08) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255, 255, 255, 0.08) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px',
        }}
      />

      {/* TOP BAR: Production Studio Telemetry Header */}
      <header className="relative z-20 h-14 border-b border-white/10 bg-black/60 backdrop-blur-md px-6 flex items-center justify-between font-mono text-xs text-[#6b7280]">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-white font-semibold tracking-wider">REC</span>
          </div>
          <span className="text-[#3b82f6] font-semibold tracking-widest text-sm bg-blue-950/40 border border-blue-800/40 px-2 py-0.5 rounded">
            {smpte}
          </span>
          <span className="hidden md:inline text-slate-400">
            SMPTE 24.00 FPS · 1080P PRORES 422
          </span>
        </div>

        <div className="flex items-center gap-6">
          <div className="hidden lg:flex items-center gap-4 text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <Database className="w-3.5 h-3.5" />
              <span>42 B-ROLL REELS LINKED</span>
            </span>
            <span className="text-slate-600">|</span>
            <span className="flex items-center gap-1.5 text-blue-400">
              <Cpu className="w-3.5 h-3.5" />
              <span>EDITORIAL ENGINE INITIALIZED</span>
            </span>
          </div>

          <span className="text-[11px] bg-white/5 border border-white/10 px-2.5 py-1 rounded text-slate-300">
            PRESS [ESC] TO SKIP
          </span>
        </div>
      </header>

      {/* CENTER WIDESCREEN WORKSPACE: Full Spatial Utilization */}
      <main className="relative z-10 flex-1 px-6 lg:px-12 py-6 flex items-center justify-between gap-8 min-h-0">
        
        {/* LEFT WING: Live Script & Beat Decomposition Monitor */}
        <div className="hidden xl:flex flex-col w-80 2xl:w-96 shrink-0 h-full max-h-[500px] bg-[#0c0e14]/80 border border-white/10 rounded-xl p-4 backdrop-blur-md shadow-2xl">
          <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
            <span className="text-[11px] font-mono font-bold tracking-wider text-blue-400 uppercase flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5" />
              <span>Editorial Breakdown Pipeline</span>
            </span>
            <span className="text-[10px] font-mono text-slate-400">ACTIVE</span>
          </div>

          {/* Workflow Steps List */}
          <div className="flex-1 flex flex-col justify-between space-y-2 font-mono text-xs">
            {workflowSteps.map((step, idx) => {
              const isCurrent = activeStepIndex === idx
              const isDone = activeStepIndex > idx

              return (
                <div
                  key={step.title}
                  className={`p-2.5 rounded-lg border transition-all ${
                    isCurrent
                      ? 'bg-blue-600/15 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.15)] text-blue-200'
                      : isDone
                      ? 'bg-white/5 border-white/5 text-slate-400'
                      : 'bg-transparent border-transparent text-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-[11px] flex items-center gap-2">
                      <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] ${
                        isDone ? 'bg-emerald-500 text-black font-bold' : isCurrent ? 'bg-blue-500 text-white' : 'bg-[#1e2230] text-slate-500'
                      }`}>
                        {isDone ? '✓' : idx + 1}
                      </span>
                      {step.title}
                    </span>
                    {isCurrent && (
                      <span className="text-[10px] text-blue-400 animate-pulse font-semibold">
                        PROCESSING
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 line-clamp-1 pl-6">
                    {step.desc}
                  </p>
                </div>
              )
            })}
          </div>

          <div className="pt-3 border-t border-white/10 text-[10px] font-mono text-slate-400 flex items-center justify-between">
            <span>PIPELINE: V2.4 AI STUDIO</span>
            <span className="text-emerald-400">100% HARDWARE ACCELERATED</span>
          </div>
        </div>

        {/* HERO CENTERPIECE: Grand Cinematic Studio Identity */}
        <div className="flex-1 flex flex-col items-center justify-center text-center relative py-4">
          {/* Optical Framing Crosshairs */}
          <div className="text-xs font-mono text-blue-400/80 mb-4 tracking-[0.3em] uppercase flex items-center gap-3">
            <span className="w-8 h-[1px] bg-gradient-to-r from-transparent to-blue-500" />
            <span>&bull; AI-ASSISTED VIDEO EDITING PLATFORM &bull;</span>
            <span className="w-8 h-[1px] bg-gradient-to-l from-transparent to-blue-500" />
          </div>

          {/* Large Hero Aperture Emblem */}
          <div className="relative mb-6">
            {/* Outer Pulsing Glow */}
            <div className="absolute -inset-4 rounded-3xl bg-blue-500/20 blur-xl animate-pulse" />
            
            {/* Main Emblem Box */}
            <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-2xl bg-gradient-to-br from-[#121624] to-[#0c0f18] border-2 border-blue-500/60 shadow-[0_0_50px_rgba(59,130,246,0.45)] flex items-center justify-center backdrop-blur-xl group overflow-hidden">
              {/* Scanline beam moving vertically */}
              <div
                className="absolute inset-x-0 h-1.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent blur-[1px]"
                style={{ top: `${(progress * 1.5) % 100}%` }}
              />
              <Film className="w-12 h-12 sm:w-14 sm:h-14 text-blue-400 drop-shadow-[0_0_20px_rgba(96,165,250,0.9)]" />
            </div>

            {/* High-Precision Corner Brackets */}
            <span className="absolute -top-2.5 -left-2.5 w-5 h-5 border-t-2 border-l-2 border-blue-400" />
            <span className="absolute -top-2.5 -right-2.5 w-5 h-5 border-t-2 border-r-2 border-blue-400" />
            <span className="absolute -bottom-2.5 -left-2.5 w-5 h-5 border-b-2 border-l-2 border-blue-400" />
            <span className="absolute -bottom-2.5 -right-2.5 w-5 h-5 border-b-2 border-r-2 border-blue-400" />
          </div>

          {/* Master Typography (Grand Scale) */}
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black tracking-tight text-white flex items-center justify-center gap-1 font-sans drop-shadow-2xl">
            <span>Script</span>
            <span className="text-blue-500 relative inline-block px-1">
              2
              <span className="absolute inset-0 text-cyan-400 blur-md opacity-70">2</span>
            </span>
            <span className="text-slate-100">Broll</span>
          </h1>

          {/* Subtitle with Wide Tracking */}
          <p className="mt-3 text-sm sm:text-base font-semibold tracking-[0.28em] uppercase text-slate-300">
            Turn Words Into Cinematic Sequences
          </p>

          {/* Big Horizontal Workflow Badge Pipeline */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-2 sm:gap-3 text-xs font-mono">
            <span className="px-3 py-1 rounded-md bg-white/5 border border-white/15 text-slate-200 shadow-sm">
              RAW SCRIPT
            </span>
            <span className="text-blue-500 font-bold">&rarr;</span>
            <span className="px-3 py-1 rounded-md bg-white/5 border border-white/15 text-slate-200 shadow-sm">
              NARRATIVE BEATS
            </span>
            <span className="text-blue-500 font-bold">&rarr;</span>
            <span className="px-3 py-1 rounded-md bg-white/5 border border-white/15 text-slate-200 shadow-sm">
              VISUAL INTENT
            </span>
            <span className="text-blue-500 font-bold">&rarr;</span>
            <span className="px-3 py-1 rounded-md bg-blue-600/30 border border-blue-500/50 text-blue-300 font-semibold shadow-[0_0_15px_rgba(59,130,246,0.3)]">
              EDITED TIMELINE
            </span>
          </div>

          {/* Wide Progress Telemetry Bar */}
          <div className="mt-10 w-full max-w-xl flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs font-mono text-slate-300">
              <span className="flex items-center gap-2 text-cyan-400 font-medium">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                CALIBRATING WORKSPACE &bull; {workflowSteps[activeStepIndex]?.title}
              </span>
              <span className="font-bold text-white">{progress}%</span>
            </div>

            {/* High-Tech Progress Track */}
            <div className="w-full h-2 bg-[#121520] rounded-full overflow-hidden border border-white/10 relative p-0.5">
              <div
                className="h-full bg-gradient-to-r from-blue-600 via-cyan-400 to-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.9)] transition-all duration-75 ease-out rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>

        {/* RIGHT WING: B-Roll Footage Rack & Library Preview */}
        <div className="hidden xl:flex flex-col w-80 2xl:w-96 shrink-0 h-full max-h-[500px] bg-[#0c0e14]/80 border border-white/10 rounded-xl p-4 backdrop-blur-md shadow-2xl">
          <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
            <span className="text-[11px] font-mono font-bold tracking-wider text-emerald-400 uppercase flex items-center gap-1.5">
              <Film className="w-3.5 h-3.5" />
              <span>Library Footage Assets ({LOCAL_LIBRARY_CLIPS.length})</span>
            </span>
            <span className="text-[10px] font-mono text-emerald-400">READY</span>
          </div>

          {/* Grid of Footage Reels from local dataset */}
          <div className="flex-1 grid grid-cols-2 gap-2.5 overflow-hidden">
            {previewClips.map((clip) => (
              <div
                key={clip.video_id}
                className="relative rounded-lg overflow-hidden border border-white/10 bg-black group"
              >
                <img
                  src={mediaUrl(clip.thumbnail_url)}
                  alt={`Reel #${clip.video_id}`}
                  className="w-full h-20 object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent flex flex-col justify-end p-2">
                  <div className="flex items-center justify-between text-[9px] font-mono text-white">
                    <span className="font-bold text-blue-400">#{clip.video_id}</span>
                    <span>{Math.round(clip.duration || 10)}s</span>
                  </div>
                  <span className="text-[8px] text-slate-400 truncate font-mono">
                    {clip.tags[0] || 'B-roll footage'}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-3 border-t border-white/10 text-[10px] font-mono text-slate-400 flex items-center justify-between">
            <span>PGVECTOR &bull; LOCAL MP4S</span>
            <span className="text-cyan-400">INSTANT RETRIEVAL</span>
          </div>
        </div>

      </main>

      {/* BOTTOM BAR: Multi-Track Timeline Calibration Strip */}
      <footer className="relative z-20 h-16 border-t border-white/10 bg-black/70 backdrop-blur-md px-6 flex items-center justify-between text-xs font-mono text-slate-400">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-blue-400 font-medium">
            <Sparkles className="w-4 h-4" />
            <span>AI CO-EDITOR ENGINE</span>
          </span>
          <span className="text-slate-600">|</span>
          <span className="hidden sm:inline text-slate-400">
            READY TO ASSEMBLE SCRIPT INTO TIMELINE SEQUENCE
          </span>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-slate-400">CLICK ANYWHERE OR PRESS</span>
          <kbd className="px-2 py-1 bg-white/10 border border-white/20 rounded text-slate-200 text-[10px] font-bold">
            ESC
          </kbd>
        </div>
      </footer>
    </div>
  )
}
