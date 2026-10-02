import { useCallback, useEffect, useState } from 'react'
import { getHealth, type HealthResult, type HealthStatus } from '../api/client'

const CHECKS = [
  { label: 'Backend API', path: '/health' },
  { label: 'PostgreSQL + pgvector', path: '/health/database' },
  { label: 'Embedding model', path: '/health/ai' },
  { label: 'Pixabay', path: '/health/pixabay' },
]

const BADGE: Record<HealthStatus, string> = {
  ok: 'bg-emerald-100 text-emerald-800',
  not_configured: 'bg-amber-100 text-amber-800',
  error: 'bg-red-100 text-red-800',
  unreachable: 'bg-red-100 text-red-800',
}

export default function HealthPanel() {
  const [results, setResults] = useState<Record<string, HealthResult | undefined>>({})

  const runChecks = useCallback(() => {
    for (const { path } of CHECKS) {
      getHealth(path).then((result) => setResults((prev) => ({ ...prev, [path]: result })))
    }
  }, [])

  useEffect(runChecks, [runChecks])

  return (
    <div>
      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200">
        {CHECKS.map(({ label, path }) => {
          const result = results[path]
          return (
            <li key={path} className="flex items-start justify-between gap-4 p-3">
              <div>
                <div className="text-sm font-medium">{label}</div>
                <code className="text-xs text-slate-500">GET {path}</code>
                {result?.detail && <div className="mt-1 text-sm text-slate-600">{result.detail}</div>}
              </div>
              <span className={`rounded px-2 py-1 text-xs font-medium ${result ? BADGE[result.status] : 'bg-slate-100 text-slate-500'}`}>
                {result?.status ?? 'checking…'}
              </span>
            </li>
          )
        })}
      </ul>
      <button
        onClick={() => {
          setResults({})
          runChecks()
        }}
        className="mt-3 rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100">
        Re-check
      </button>
    </div>
  )
}
