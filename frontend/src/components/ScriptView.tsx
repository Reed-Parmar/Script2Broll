import { useRef, useState, type FormEvent } from 'react'
import { SearchError, analyzeScript, type Beat, type ScriptResponse } from '../api/client'
import EditorialPanel from './EditorialPanel'
import ResultCard from './ResultCard'

const TOP_K = 6
const EXAMPLE = `Electric vehicles are becoming increasingly popular.
However, charging infrastructure remains a major challenge.
This could slow adoption in smaller cities.`

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; response: ScriptResponse }

/** Phase 4 demo: script -> beats -> editorial intent + B-roll per beat. Not the editor/timeline. */
export default function ScriptView() {
  const [script, setScript] = useState(EXAMPLE)
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [selected, setSelected] = useState(0)
  const inFlight = useRef<AbortController | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!script.trim()) {
      setState({ kind: 'error', message: 'Please enter a script.' })
      return
    }
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    setState({ kind: 'loading' })
    try {
      const response = await analyzeScript(script, TOP_K, controller.signal)
      setSelected(0)
      setState({ kind: 'done', response })
    } catch (error) {
      if (controller.signal.aborted) return
      setState({ kind: 'error', message: error instanceof SearchError ? error.message : 'Something went wrong.' })
    }
  }

  const beats = state.kind === 'done' ? state.response.beats : []
  const beat = beats[selected]

  return (
    <div className="mt-3">
      <form onSubmit={onSubmit}>
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          rows={6}
          maxLength={5000}
          aria-label="Script"
          placeholder="Paste a narration script…"
          className="w-full rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={state.kind === 'loading'}
          className="mt-2 rounded bg-slate-900 px-5 py-2 text-white hover:bg-slate-700 disabled:opacity-60">
          {state.kind === 'loading' ? 'Analysing script…' : 'Analyse script'}
        </button>
      </form>

      <section className="mt-6" aria-live="polite">
        {state.kind === 'loading' && (
          <p className="text-slate-500">Splitting into beats, analysing each beat and finding B-roll… (a few seconds per beat)</p>
        )}
        {state.kind === 'error' && (
          <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-red-800">
            {state.message}
          </p>
        )}
        {state.kind === 'done' && (
          <>
            {state.response.segmentation.method === 'sentence_fallback' && (
              <p role="status" className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
                The beat grouping from the language model was invalid, so each sentence became its own beat (
                {state.response.segmentation.error}).
              </p>
            )}
            <p className="mb-3 text-sm text-slate-500">
              {beats.length} beats · {state.response.top_k} clips per beat ({state.response.model}) ·{' '}
              {Math.round((state.response.timings_ms.total ?? 0) / 100) / 10} s
            </p>
            <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
              <ol className="space-y-2">
                {beats.map((b, i) => (
                  <li key={b.beat_id}>
                    <BeatButton beat={b} active={i === selected} onClick={() => setSelected(i)} />
                  </li>
                ))}
              </ol>
              {beat && <BeatDetail beat={beat} />}
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function BeatButton({ beat, active, onClick }: { beat: Beat; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-current={active}
      className={`w-full rounded border p-2 text-left text-sm ${active ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:bg-slate-50'}`}>
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium text-slate-500">#{beat.order}</span>
        {beat.status === 'ok' ? (
          <span className="rounded bg-indigo-100 px-1.5 py-0.5 font-medium text-indigo-800">
            {beat.editorial_intent?.replace('_', ' ')}
          </span>
        ) : (
          <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-800">failed</span>
        )}
      </div>
      <p className="mt-1 line-clamp-3">{beat.text}</p>
    </button>
  )
}

function BeatDetail({ beat }: { beat: Beat }) {
  return (
    <div>
      <blockquote className="mb-3 border-l-4 border-slate-300 pl-3 text-slate-700">{beat.text}</blockquote>
      {beat.error && (
        <p role="alert" className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          This beat could not be processed: {beat.error}
        </p>
      )}
      {beat.editorial_intent && beat.retrieval_query && (
        <EditorialPanel
          editorial={{
            original_text: beat.text,
            topic: beat.topic ?? '',
            editorial_intent: beat.editorial_intent,
            visual_role: beat.visual_role ?? '',
            visual_description: beat.visual_description ?? '',
            retrieval_query: beat.retrieval_query,
          }}
        />
      )}
      {beat.warnings.map((warning) => (
        <p key={warning} className="mb-2 rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
          {warning}
        </p>
      ))}
      {beat.editorial_intent && <SearchedFor beat={beat} />}
      {beat.status === 'ok' && beat.broll_results.length === 0 && (
        <p className="text-slate-500">No clips found for this beat.</p>
      )}
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {beat.broll_results.map((result, i) => (
          <ResultCard key={result.video_id} result={result} rank={i + 1} note={`via: ${result.matched_query}`} />
        ))}
      </ul>
    </div>
  )
}

/** What the beat's B-roll was searched for: the filmable concepts and every query that was run. */
function SearchedFor({ beat }: { beat: Beat }) {
  return (
    <div className="mb-4 grid gap-3 text-sm sm:grid-cols-2">
      {beat.filmable_visuals.length > 0 && (
        <div>
          <div className="font-medium">Visual concepts</div>
          <ul className="mt-1 list-disc pl-5 text-slate-700">
            {beat.filmable_visuals.map((visual) => (
              <li key={visual}>{visual}</li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <div className="font-medium">Queries searched (clips ranked by their best match)</div>
        <ol className="mt-1 list-decimal pl-5">
          {[beat.retrieval_query, ...beat.alternative_queries].map((query, i) => (
            <li key={`${i}-${query}`}>
              <code className="rounded bg-slate-100 px-1 text-slate-800">{query}</code>
              {i === 0 && <span className="ml-1 text-xs text-slate-500">(primary)</span>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
