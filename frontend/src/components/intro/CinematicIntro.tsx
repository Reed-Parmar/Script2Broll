import { useEffect, useState } from 'react'
import { Film, Sparkles } from 'lucide-react'

interface CinematicIntroProps {
  onComplete: () => void
}

export default function CinematicIntro({ onComplete }: CinematicIntroProps) {
  const [phase, setPhase] = useState<'calibrate' | 'reveal' | 'ready' | 'exit'>('calibrate')
  const [progress, setProgress] = useState(0)
  const [telemetryText, setTelemetryText] = useState('CALIBRATING EDITORIAL ENGINE…')

  useEffect(() => {
    // 0ms - 700ms: Phase 1 (Calibrate timeline grid & telemetry)
    const t1 = setTimeout(() => {
      setPhase('reveal')
      setTelemetryText('INITIALIZING B-ROLL REELS (42 ASSETS)…')
    }, 700)

    // 700ms - 1700ms: Phase 2 (Reveal brand & telemetry)
    const t2 = setTimeout(() => {
      setPhase('ready')
      setTelemetryText('STUDIO TIMELINE READY')
    }, 1700)

    // 1700ms - 2400ms: Phase 3 (Exit dissolve transition starts)
    const t3 = setTimeout(() => {
      setPhase('exit')
    }, 2350)

    // 2700ms: Intro completes and unmounts
    const t4 = setTimeout(() => {
      onComplete()
    }, 2700)

    // Animate the sleek progress bar from 0 to 100% over 2.4s
    const start = performance.now()
    const duration = 2300

    let animId: number
    const updateProgress = () => {
      const elapsed = performance.now() - start
      const pct = Math.min(100, Math.round((elapsed / duration) * 100))
      setProgress(pct)
      if (elapsed < duration) {
        animId = requestAnimationFrame(updateProgress)
      }
    }
    animId = requestAnimationFrame(updateProgress)

    // Escape key or click to skip immediately
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
      cancelAnimationFrame(animId)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onComplete])

  return (
    <div
      onClick={onComplete}
      className={`fixed inset-0 z-[100] flex flex-col justify-between bg-[#07080b] select-none cursor-pointer overflow-hidden transition-all duration-500 ease-out ${
        phase === 'exit'
          ? 'opacity-0 scale-[1.03] pointer-events-none'
          : 'opacity-100 scale-100'
      }`}
    >
      {/* Cinematic Top Letterbox Matte */}
      <div
        className={`w-full bg-black border-b border-white/5 transition-all duration-700 ease-out z-20 ${
          phase === 'exit' ? 'h-0' : 'h-10 sm:h-14'
        }`}
      >
        <div className="h-full px-6 flex items-center justify-between text-[10px] font-mono text-[#4a5065] tracking-widest uppercase">
          <span>SMPTE 24.00 FPS · 1080P REC.709</span>
          <span className="hidden sm:inline">AI-ASSISTED EDITORIAL SUITE</span>
          <span>SCENE 01 / TAKE 01</span>
        </div>
      </div>

      {/* Ambient Radial Spotlight */}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.12)_0%,rgba(7,8,11,0.95)_70%)]" />

      {/* Subtle Cinematic Grid Background */}
      <div
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(255, 255, 255, 0.04) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255, 255, 255, 0.04) 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px',
        }}
      />

      {/* Center Cinematic Content */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-4">
        {/* Optical Alignment Brackets */}
        <div className="relative flex flex-col items-center">
          {/* Top Focus Crosshair */}
          <div className="text-[10px] font-mono text-blue-400/60 mb-3 tracking-widest flex items-center gap-2">
            <span className="w-4 h-[1px] bg-blue-500/40" />
            <span>[ FOCUS: SCRIPT &rarr; TIMELINE ]</span>
            <span className="w-4 h-[1px] bg-blue-500/40" />
          </div>

          {/* Aperture Logo Frame */}
          <div className="relative mb-5 group">
            {/* Outer Rotating / Glowing Pulse */}
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br from-blue-600/30 to-blue-900/10 border border-blue-500/50 flex items-center justify-center shadow-[0_0_35px_rgba(59,130,246,0.35)] relative overflow-hidden backdrop-blur-md">
              {/* Scanline Sweep inside icon */}
              <div
                className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-blue-400 to-transparent animate-pulse"
                style={{ top: `${progress % 100}%` }}
              />
              <Film className="w-8 h-8 sm:w-10 sm:h-10 text-blue-400 drop-shadow-[0_0_12px_rgba(96,165,250,0.8)]" />
            </div>

            {/* Corner Precision Targets */}
            <span className="absolute -top-1.5 -left-1.5 w-3 h-3 border-t-2 border-l-2 border-blue-400" />
            <span className="absolute -top-1.5 -right-1.5 w-3 h-3 border-t-2 border-r-2 border-blue-400" />
            <span className="absolute -bottom-1.5 -left-1.5 w-3 h-3 border-b-2 border-l-2 border-blue-400" />
            <span className="absolute -bottom-1.5 -right-1.5 w-3 h-3 border-b-2 border-r-2 border-blue-400" />
          </div>

          {/* Brand Typography */}
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-white flex items-center gap-1 font-sans">
            <span>Script</span>
            <span className="text-blue-500 font-extrabold relative inline-block px-1">
              2
              <span className="absolute inset-0 text-blue-400 blur-sm opacity-60">2</span>
            </span>
            <span className="text-slate-100">Broll</span>
          </h1>

          {/* Subtitle with High-Tech Tracking */}
          <p className="mt-2 text-xs sm:text-sm font-medium tracking-[0.25em] uppercase text-slate-400 text-center">
            AI-Assisted Video Editor
          </p>

          {/* Workflow Sequence Steps Pills */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-1.5 text-[10px] sm:text-[11px] font-mono text-slate-400">
            <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-slate-300">
              SCRIPT
            </span>
            <span className="text-blue-500">&rarr;</span>
            <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-slate-300">
              EDITORIAL BEATS
            </span>
            <span className="text-blue-500">&rarr;</span>
            <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-slate-300">
              VISUAL INTENT
            </span>
            <span className="text-blue-500">&rarr;</span>
            <span className="px-2 py-0.5 rounded bg-blue-600/20 border border-blue-500/40 text-blue-300 font-medium">
              B-ROLL SEQUENCE
            </span>
          </div>

          {/* Telemetry Status Bar */}
          <div className="mt-8 w-72 sm:w-96 flex flex-col gap-2">
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
              <span className="flex items-center gap-1.5 text-blue-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
                {telemetryText}
              </span>
              <span>{progress}%</span>
            </div>

            {/* Precision Loading Track */}
            <div className="w-full h-1 bg-[#1a1d28] rounded-full overflow-hidden border border-white/5 relative">
              <div
                className="h-full bg-gradient-to-r from-blue-600 to-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.8)] transition-all duration-75 ease-out rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Cinematic Bottom Letterbox Matte */}
      <div
        className={`w-full bg-black border-t border-white/5 transition-all duration-700 ease-out z-20 ${
          phase === 'exit' ? 'h-0' : 'h-10 sm:h-14'
        }`}
      >
        <div className="h-full px-6 flex items-center justify-between text-[10px] font-mono text-[#545b73]">
          <span className="flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-blue-400/70" />
            <span>DIRECTOR CONSOLE ACTIVE</span>
          </span>
          <span className="hover:text-slate-300 transition-colors">
            PRESS [ESC] OR CLICK TO SKIP
          </span>
        </div>
      </div>
    </div>
  )
}
