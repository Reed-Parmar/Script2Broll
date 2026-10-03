import { Film, FileText, Search, Sun, Moon, Server, Play } from 'lucide-react'
import type { HealthResult } from '../../api/client'

export type NavTab = 'script_to_beat' | 'semantic_search'

interface NavbarProps {
  activeTab: NavTab
  onTabChange: (tab: NavTab) => void
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  onOpenHealth: () => void
  healthSummary: HealthResult | null
  onReplayIntro: () => void
}

export default function Navbar({
  activeTab,
  onTabChange,
  theme,
  onToggleTheme,
  onOpenHealth,
  healthSummary,
  onReplayIntro,
}: NavbarProps) {
  const isHealthy = healthSummary?.status === 'ok'
  const isWarning = healthSummary?.status === 'not_configured'
  const isError = healthSummary?.status === 'error' || healthSummary?.status === 'unreachable'

  return (
    <header className="relative h-14 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 sm:px-6 flex items-center justify-between select-none shadow-xs transition-colors duration-200">
      {/* Brand Identity */}
      <div className="flex items-center gap-3">
        <button
          onClick={onReplayIntro}
          title="Click to replay studio intro"
          className="flex items-center gap-2 group text-left"
        >
          <div className="w-8 h-8 rounded-lg bg-blue-600/15 border border-blue-500/30 flex items-center justify-center text-blue-500 group-hover:scale-105 group-hover:bg-blue-600/25 transition-all">
            <Film className="w-4 h-4" />
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-sm tracking-tight text-[var(--text-primary)]">
              Script<span className="text-blue-500">2</span>Broll
            </span>
            <span className="text-[10px] text-[var(--text-muted)] font-mono -mt-0.5">
              AI Video Platform
            </span>
          </div>
        </button>
      </div>

      {/* Main Navigation Tabs - Centered */}
      <nav className="sm:absolute sm:left-1/2 sm:-translate-x-1/2 flex items-center bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg p-1 text-xs font-medium shadow-xs">
        <button
          onClick={() => onTabChange('script_to_beat')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md transition-all ${
            activeTab === 'script_to_beat'
              ? 'bg-[var(--bg-surface)] text-blue-500 shadow-xs font-semibold'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Script to Beat</span>
        </button>

        <button
          onClick={() => onTabChange('semantic_search')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md transition-all ${
            activeTab === 'semantic_search'
              ? 'bg-[var(--bg-surface)] text-blue-500 shadow-xs font-semibold'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          <Search className="w-3.5 h-3.5" />
          <span>Semantic Search</span>
        </button>
      </nav>

      {/* Right Controls: Replay Intro, Health, Theme Toggle */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Replay Intro Button */}
        <button
          onClick={onReplayIntro}
          title="Play 2-3s cinematic studio intro"
          className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] rounded-lg transition-colors"
        >
          <Play className="w-3 h-3 text-blue-500 fill-blue-500" />
          <span>Intro</span>
        </button>

        {/* Backend Health Status */}
        <button
          onClick={onOpenHealth}
          title="Service Health & Diagnostic Status"
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <span
            className={`w-2 h-2 rounded-full ${
              isHealthy
                ? 'bg-emerald-500'
                : isWarning
                ? 'bg-amber-500'
                : isError
                ? 'bg-rose-500'
                : 'bg-slate-400'
            }`}
          />
          <Server className="w-3.5 h-3.5 text-[var(--text-muted)]" />
          <span className="hidden lg:inline text-[11px]">
            {isHealthy ? 'Backend OK' : isError ? 'Offline' : 'Diagnostics'}
          </span>
        </button>

        {/* Light / Dark Mode Toggle */}
        <button
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          className="p-2 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          {theme === 'dark' ? (
            <Sun className="w-4 h-4 text-amber-400" />
          ) : (
            <Moon className="w-4 h-4 text-blue-600" />
          )}
        </button>
      </div>
    </header>
  )
}
