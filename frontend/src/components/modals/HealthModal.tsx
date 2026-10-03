import { useState, useEffect, useCallback } from 'react'
import { Server, CheckCircle2, AlertTriangle, XCircle, RefreshCw, X, Database, Cpu, Image } from 'lucide-react'
import { getHealth, type HealthResult, type HealthStatus } from '../../api/client'

interface HealthModalProps {
  isOpen: boolean
  onClose: () => void
}

const CHECKS = [
  { label: 'Backend API Service', path: '/health', icon: Server, desc: 'FastAPI core process and HTTP server' },
  { label: 'PostgreSQL + pgvector', path: '/health/database', icon: Database, desc: 'Vector database and embeddings table' },
  { label: 'AI Embedding & LLM', path: '/health/ai', icon: Cpu, desc: 'OpenCLIP / Gemini embedding model provider' },
  { label: 'Pixabay Video Source', path: '/health/pixabay', icon: Image, desc: 'External stock footage provider' },
]

export default function HealthModal({ isOpen, onClose }: HealthModalProps) {
  const [results, setResults] = useState<Record<string, HealthResult | undefined>>({})
  const [isChecking, setIsChecking] = useState(false)

  const runAllChecks = useCallback(async () => {
    setIsChecking(true)
    for (const { path } of CHECKS) {
      try {
        const res = await getHealth(path)
        setResults((prev) => ({ ...prev, [path]: res }))
      } catch {
        setResults((prev) => ({
          ...prev,
          [path]: { status: 'unreachable', detail: 'Could not contact server' },
        }))
      }
    }
    setIsChecking(false)
  }, [])

  useEffect(() => {
    if (isOpen) {
      void runAllChecks()
    }
  }, [isOpen, runAllChecks])

  if (!isOpen) return null

  function getStatusBadge(status?: HealthStatus) {
    if (!status) {
      return (
        <span className="text-[10px] text-slate-500 flex items-center gap-1">
          <RefreshCw className="w-3 h-3 animate-spin" /> Checking
        </span>
      )
    }

    if (status === 'ok') {
      return (
        <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded">
          <CheckCircle2 className="w-3 h-3" /> Operational
        </span>
      )
    }

    if (status === 'not_configured') {
      return (
        <span className="flex items-center gap-1 text-[10px] font-medium text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded">
          <AlertTriangle className="w-3 h-3" /> Config Required
        </span>
      )
    }

    return (
      <span className="flex items-center gap-1 text-[10px] font-medium text-rose-400 bg-rose-500/10 border border-rose-500/30 px-2 py-0.5 rounded">
        <XCircle className="w-3 h-3" /> Offline / Error
      </span>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-lg bg-[#161820] border border-[#282c3c] rounded-lg shadow-2xl p-5 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#242735]">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-blue-400" />
            <div>
              <h3 className="text-xs font-semibold text-slate-100 uppercase tracking-wider">
                System Diagnostics & Service Health
              </h3>
              <p className="text-[11px] text-slate-400">
                Backend API connectivity & database integration
              </p>
            </div>
          </div>

          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Checks List */}
        <div className="space-y-2.5">
          {CHECKS.map(({ label, path, icon: Icon, desc }) => {
            const res = results[path]

            return (
              <div
                key={path}
                className="p-3 rounded-md bg-[#121319] border border-[#222532] flex items-start justify-between gap-3"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="p-1.5 rounded bg-[#1a1d28] border border-[#282c3c] text-slate-300 mt-0.5">
                    <Icon className="w-3.5 h-3.5" />
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-slate-200">{label}</span>
                      <code className="text-[10px] text-slate-500 font-mono">GET {path}</code>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">{desc}</p>
                    {res?.detail && (
                      <p className="text-[10px] text-amber-300/80 mt-1 font-mono break-all">
                        {String(res.detail)}
                      </p>
                    )}
                  </div>
                </div>

                <div className="shrink-0">{getStatusBadge(res?.status)}</div>
              </div>
            )
          })}
        </div>

        {/* Footer Actions */}
        <div className="pt-2 border-t border-[#242735] flex items-center justify-between">
          <button
            onClick={() => {
              setResults({})
              void runAllChecks()
            }}
            disabled={isChecking}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-300 hover:text-white bg-[#202330] hover:bg-[#282c3c] border border-[#2a2e3d] rounded transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
            <span>Re-check Services</span>
          </button>

          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-[#252836] hover:bg-[#303444] text-slate-200 rounded text-xs font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
