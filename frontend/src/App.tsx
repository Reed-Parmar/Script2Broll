import { useRef, useState, type FormEvent } from 'react'
import { SearchError, searchVideos, type SearchResponse } from './api/client'
import HealthPanel from './components/HealthPanel'
import ResultCard from './components/ResultCard'

const TOP_K = 12
const EXAMPLES = ['people charging an electric vehicle', 'busy city traffic', 'doctor treating a patient', 'mountain landscape']

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; response: SearchResponse }

export default function App() {
  const [query, setQuery] = useState('')
  const [state, setState] = useState<State>({ kind: 'idle' })
  const inFlight = useRef<AbortController | null>(null)

  async function runSearch(text: string) {
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
      const response = await searchVideos(trimmed, TOP_K, controller.signal)
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

      <form onSubmit={onSubmit} className="mt-6 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. people charging an electric vehicle"
          maxLength={500}
          aria-label="Search query"
          className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={state.kind === 'loading'}
          className="rounded bg-slate-900 px-5 py-2 text-white hover:bg-slate-700 disabled:opacity-60">
          {state.kind === 'loading' ? 'Searching…' : 'Search'}
        </button>
      </form>
      <div className="mt-2 flex flex-wrap gap-2 text-sm">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            onClick={() => {
              setQuery(example)
              void runSearch(example)
            }}
            className="rounded-full border border-slate-200 px-3 py-1 text-slate-600 hover:bg-slate-100">
            {example}
          </button>
        ))}
      </div>

      <section className="mt-6" aria-live="polite">
        {state.kind === 'loading' && <p className="text-slate-500">Searching…</p>}
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
              {state.response.results.length} results for “{state.response.query}” · ranked by cosine similarity (
              {state.response.model}) · {Math.round(state.response.timings_ms.total ?? 0)} ms
            </p>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {state.response.results.map((result, i) => (
                <ResultCard key={result.video_id} result={result} rank={i + 1} />
              ))}
            </ul>
          </>
        )}
      </section>

      <details className="mt-10">
        <summary className="cursor-pointer text-sm text-slate-500">Service status</summary>
        <div className="mt-3 max-w-2xl">
          <HealthPanel />
        </div>
      </details>
    </main>
  )
}
