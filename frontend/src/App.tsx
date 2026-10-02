import { useRef, useState, type FormEvent } from 'react'
import { SearchError, searchVideos, type SearchMode, type SearchResponse } from './api/client'
import EditorialPanel from './components/EditorialPanel'
import HealthPanel from './components/HealthPanel'
import ResultCard from './components/ResultCard'
import ScriptView from './components/ScriptView'

const TOP_K = 12
const MODES: Record<SearchMode, { label: string; placeholder: string; examples: string[] }> = {
  semantic: {
    label: 'Semantic search',
    placeholder: 'e.g. people charging an electric vehicle',
    examples: ['people charging an electric vehicle', 'busy city traffic', 'doctor treating a patient', 'mountain landscape'],
  },
  editorial: {
    label: 'Editorial search',
    placeholder: 'Paste a script sentence, e.g. "Despite rapid growth, charging infrastructure remains a major obstacle."',
    examples: [
      'Despite the rapid growth of electric vehicles, charging infrastructure remains a major obstacle.',
      'Every morning, millions of commuters pour into the city centre.',
      'For many families, a hospital visit can mean weeks of lost income.',
    ],
  },
}
// The script mode is a separate flow (beats), not a search mode.
type Mode = SearchMode | 'script'
const MODE_LABELS: Record<Mode, string> = { semantic: 'Semantic search', editorial: 'Editorial search', script: 'Script → beats' }

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; response: SearchResponse }

export default function App() {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<Mode>('semantic')
  const [state, setState] = useState<State>({ kind: 'idle' })
  const inFlight = useRef<AbortController | null>(null)

  async function runSearch(text: string) {
    if (mode === 'script') return
    const trimmed = text.trim()
    if (!trimmed) {
      setState({ kind: 'error', message: 'Please enter a search query.' })
      return
    }
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    setState({ kind: 'loading' })
    try {
      const response = await searchVideos(trimmed, TOP_K, mode, controller.signal)
      setState({ kind: 'done', response })
    } catch (error) {
      if (controller.signal.aborted) return
      setState({ kind: 'error', message: error instanceof SearchError ? error.message : 'Something went wrong.' })
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void runSearch(query)
  }

  return (
    <main className="mx-auto max-w-6xl p-6 font-sans text-slate-900 sm:p-8">
      <h1 className="text-2xl font-semibold">Script2Broll</h1>
      <p className="mt-1 text-slate-600">Semantic B-roll search: describe the shot, get matching stock clips.</p>

      <div role="radiogroup" aria-label="Search mode" className="mt-6 inline-flex rounded border border-slate-300 p-0.5 text-sm">
        {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
          <button
            key={m}
            role="radio"
            aria-checked={mode === m}
            onClick={() => {
              inFlight.current?.abort()
              setMode(m)
              setState({ kind: 'idle' })
            }}
            className={`rounded px-3 py-1 ${mode === m ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>
      {mode === 'editorial' && (
        <p className="mt-2 text-sm text-slate-500">
          A language model interprets what the line is trying to show, then the visual description is searched.
        </p>
      )}
      {mode === 'script' && (
        <p className="mt-2 text-sm text-slate-500">
          The script is split into beats; each beat gets an editorial analysis and its own B-roll candidates.
        </p>
      )}

      {mode === 'script' ? (
        <ScriptView />
      ) : (
        <>
          <form onSubmit={onSubmit} className="mt-3 flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={MODES[mode].placeholder}
              maxLength={500}
              aria-label="Search query"
              className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={state.kind === 'loading'}
              className="rounded bg-slate-900 px-5 py-2 text-white hover:bg-slate-700 disabled:opacity-60">
              {state.kind === 'loading' ? (mode === 'editorial' ? 'Analysing…' : 'Searching…') : 'Search'}
            </button>
          </form>
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            {MODES[mode].examples.map((example) => (
              <button
                key={example}
                onClick={() => {
                  setQuery(example)
                  void runSearch(example)
                }}
                className="max-w-full truncate rounded-full border border-slate-200 px-3 py-1 text-slate-600 hover:bg-slate-100">
                {example}
              </button>
            ))}
          </div>

          <section className="mt-6" aria-live="polite">
            {state.kind === 'loading' && (
              <p className="text-slate-500">{mode === 'editorial' ? 'Analysing editorial intent, then searching…' : 'Searching…'}</p>
            )}
            {state.kind === 'done' && state.response.editorial && <EditorialPanel editorial={state.response.editorial} />}
            {state.kind === 'error' && (
              <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-red-800">
                {state.message}
              </p>
            )}
            {state.kind === 'done' && state.response.results.length === 0 && (
              <p className="text-slate-500">No clips found. The library may not be indexed yet (run scripts.ingest).</p>
            )}
            {state.kind === 'done' && state.response.results.length > 0 && (
              <>
                <p className="mb-3 text-sm text-slate-500">
                  {state.response.results.length} results for “{state.response.retrieval_query}” · {MODES[state.response.mode].label.toLowerCase()} ·
                  ranked by cosine similarity ({state.response.model}) · {Math.round(state.response.timings_ms.total ?? 0)} ms
                </p>
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {state.response.results.map((result, i) => (
                    <ResultCard key={result.video_id} result={result} rank={i + 1} />
                  ))}
                </ul>
              </>
            )}
          </section>
        </>
      )}

      <details className="mt-10">
        <summary className="cursor-pointer text-sm text-slate-500">Service status</summary>
        <div className="mt-3 max-w-2xl">
          <HealthPanel />
        </div>
      </details>
    </main>
  )
}
