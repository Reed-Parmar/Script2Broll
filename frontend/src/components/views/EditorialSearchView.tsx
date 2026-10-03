import { useState, useEffect, useRef } from 'react'
import { Sparkles, SlidersHorizontal, Play, Clock, CheckCircle2, RefreshCw } from 'lucide-react'
import {
  getEditorialIntents,
  getVibeVocabulary,
  mediaUrl,
  searchVideos,
  SearchError,
  type EditorialIntentResult,
  type IntentOption,
  type SearchResult,
} from '../../api/client'

// Option values: '' = let the model decide / no mood; intents are backend enum values;
// moods are "<category>:<tag>" from the backend vibe vocabulary.
const AUTO = ''

function moodToVibe(mood: string): Record<string, string[]> | null {
  const [category, tag] = mood.split(':')
  return category && tag ? { [category]: [tag] } : null
}

const SAMPLE_EDITORIAL_PROMPTS = [
  {
    sentence: 'However, charging infrastructure remains critically limited, creating anxiety for everyday drivers.',
    intent: 'problem',
    tone: 'mood:tense',
    query: 'charging plug electric car charging station traffic',
  },
  {
    sentence: 'Artificial intelligence models analyze millions of diagnostic scans to pinpoint anomalies.',
    intent: 'explanation',
    tone: 'visual_style:documentary',
    query: 'doctor x-ray hospital technology diagnosis medicine',
  },
  {
    sentence: 'Global capital markets shift in milliseconds as high-frequency algorithms execute trades.',
    intent: 'process',
    tone: 'energy:energetic',
    query: 'stock market financial exchange graph profits analysis',
  },
  {
    sentence: 'Across pristine alpine valleys, clean renewable wind energy powers regional transit.',
    intent: 'conclusion',
    tone: 'atmosphere:natural',
    query: 'mountain snow nature landscape clouds travel',
  },
]

export default function EditorialSearchView() {
  const [statement, setStatement] = useState(SAMPLE_EDITORIAL_PROMPTS[0].sentence)
  const [editorialIntent, setEditorialIntent] = useState(SAMPLE_EDITORIAL_PROMPTS[0].intent)
  const [visualTone, setVisualTone] = useState(SAMPLE_EDITORIAL_PROMPTS[0].tone)
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [activePreview, setActivePreview] = useState<SearchResult | null>(null)
  const [analysis, setAnalysis] = useState<EditorialIntentResult | null>(null)
  const [appliedInfo, setAppliedInfo] = useState<{ intentSource: string | null; vibe: Record<string, string[]> | null }>({ intentSource: null, vibe: null })
  const [searchError, setSearchError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [intentOptions, setIntentOptions] = useState<IntentOption[]>([])
  const [vibeVocabulary, setVibeVocabulary] = useState<Record<string, string[]>>({})

  // Step 2/3 options come from the backend so the UI never invents its own vocabulary.
  useEffect(() => {
    getEditorialIntents().then(setIntentOptions).catch(() => setIntentOptions([]))
    getVibeVocabulary().then(setVibeVocabulary).catch(() => setVibeVocabulary({}))
  }, [])
  const videoRefs = useRef<Record<number, HTMLVideoElement | null>>({})

  useEffect(() => {
    void executeEditorialSearch(statement, editorialIntent, visualTone)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Step 2 (intent) steers the backend's editorial analysis; Step 3 (mood) re-orders the retrieved
  // clips with the backend's vibe scoring. Empty values let the backend decide / apply no mood.
  async function executeEditorialSearch(stmt: string, intent: string, tone: string) {
    setIsSearching(true)
    setSearchError(null)
    try {
      const resp = await searchVideos(stmt, 12, 'editorial', undefined, {
        intent: intent || null,
        vibe: moodToVibe(tone),
      })
      setResults(resp.results)
      setAnalysis(resp.editorial)
      setAppliedInfo({ intentSource: resp.intent_source ?? null, vibe: resp.vibe ?? null })
    } catch (error) {
      setResults([])
      setAnalysis(null)
      setSearchError(error instanceof SearchError ? error.message : 'Editorial search failed.')
    } finally {
      setIsSearching(false)
      setHasSearched(true)
    }
  }

  function handleSelectPrompt(prompt: (typeof SAMPLE_EDITORIAL_PROMPTS)[0]) {
    setStatement(prompt.sentence)
    setEditorialIntent(prompt.intent)
    setVisualTone(prompt.tone)
    void executeEditorialSearch(prompt.sentence, prompt.intent, prompt.tone)
  }

  return (
    <div className="flex-1 flex flex-col p-4 sm:p-6 gap-6 max-w-7xl mx-auto w-full overflow-y-auto">
      {/* Editorial Header */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-6 shadow-xs flex flex-col gap-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-500">
              <Sparkles className="w-4 h-4" />
            </div>
            <h1 className="text-base sm:text-lg font-bold text-[var(--text-primary)]">
              Editorial Intent Search
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-[var(--text-muted)]">
            Search footage guided by narrative purpose, dramatic role, and visual tone rather than raw keywords.
          </p>
        </div>

        {/* Narrative Statement Input */}
        <div className="flex flex-col gap-3">
          <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
            Step 1: Script Sentence or Narrative Beat
          </label>
          <textarea
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            rows={2}
            placeholder="Enter the script line or story beat you need visuals for..."
            className="w-full bg-[var(--bg-card)] border border-[var(--border-subtle)] focus:border-blue-500 rounded-lg p-3 text-xs sm:text-sm text-[var(--text-primary)] focus:outline-none transition-colors leading-relaxed"
          />
        </div>

        {/* Editorial Role & Tone Selectors */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider block mb-1.5">
              Step 2: Editorial Intent / Dramatic Role
            </label>
            <select
              value={editorialIntent}
              onChange={(e) => setEditorialIntent(e.target.value)}
              className="w-full bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-lg px-3 py-2 text-xs sm:text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value={AUTO}>Auto — let the model decide</option>
              {intentOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.value.replace('_', ' ')} — {opt.description}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider block mb-1.5">
              Step 3: Visual Mood / Atmospheric Tone
            </label>
            <select
              value={visualTone}
              onChange={(e) => setVisualTone(e.target.value)}
              className="w-full bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-lg px-3 py-2 text-xs sm:text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value={AUTO}>No mood preference</option>
              {Object.entries(vibeVocabulary).map(([category, tags]) => (
                <optgroup key={category} label={category.replace('_', ' ')}>
                  {tags.map((tag) => (
                    <option key={`${category}:${tag}`} value={`${category}:${tag}`}>
                      {tag}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>

        {/* Action Buttons & Presets */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-[var(--border-subtle)]">
          <div className="flex items-center gap-1.5 flex-wrap text-xs">
            <span className="text-[11px] text-[var(--text-muted)] font-mono">Example Presets:</span>
            {SAMPLE_EDITORIAL_PROMPTS.map((p, i) => (
              <button
                key={i}
                onClick={() => handleSelectPrompt(p)}
                className="px-2.5 py-1 text-[11px] rounded-md bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                {p.intent.split('/')[0]}
              </button>
            ))}
          </div>

          <button
            onClick={() => executeEditorialSearch(statement, editorialIntent, visualTone)}
            disabled={isSearching}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 shadow-xs transition-colors shrink-0"
          >
            {isSearching ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Evaluating Footage…</span>
              </>
            ) : (
              <>
                <SlidersHorizontal className="w-4 h-4" />
                <span>Retrieve Editorial B-Roll</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Editorial Reasoning Banner */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-4 text-xs flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          <span className="text-[var(--text-secondary)]">
            {analysis ? (
              <>
                Backend analysis: intent <strong className="text-[var(--text-primary)] font-medium">&ldquo;{analysis.editorial_intent}&rdquo;</strong>
                {appliedInfo.intentSource === 'user' ? ' (your choice)' : ' (model)'},
                {appliedInfo.vibe ? ` mood ${Object.entries(appliedInfo.vibe).map(([c, t]) => `${c}: ${t.join(', ')}`).join('; ')},` : ''}
                shot <strong className="text-[var(--text-primary)] font-medium">&ldquo;{analysis.visual_description}&rdquo;</strong> &mdash; searched{' '}
                <code className="font-mono text-[10px]">{analysis.retrieval_query}</code>
              </>
            ) : (
              <>Run a search to see how the backend interprets this sentence.</>
            )}
          </span>
        </div>
        <span className="text-[11px] font-mono text-[var(--text-muted)] shrink-0 hidden sm:inline">
          {results.length} ranked matches
        </span>
      </div>

      {searchError && (
        <p role="alert" className="text-xs text-red-500 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
          {searchError}
        </p>
      )}
      {!searchError && !isSearching && hasSearched && results.length === 0 && (
        <p className="text-xs text-[var(--text-muted)] px-1">No clips matched this query in the indexed library.</p>
      )}
      {/* Results Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {results.map((result, i) => (
          <div
            key={result.video_id}
            onMouseEnter={() => videoRefs.current[result.video_id]?.play().catch(() => {})}
            onMouseLeave={() => videoRefs.current[result.video_id]?.pause()}
            className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-blue-500 rounded-xl overflow-hidden shadow-xs hover:shadow-md transition-all flex flex-col group"
          >
            <div className="relative aspect-video bg-black overflow-hidden">
              <video
                ref={(el) => {
                  videoRefs.current[result.video_id] = el
                }}
                src={mediaUrl(result.video_url)}
                poster={mediaUrl(result.thumbnail_url)}
                muted
                loop
                playsInline
                className="w-full h-full object-cover"
              />

              <div className="absolute top-2 left-2 bg-black/80 px-2 py-0.5 rounded-md text-[10px] font-mono text-white flex items-center gap-1.5">
                <span className="text-blue-400 font-bold">Candidate #{i + 1}</span>
                <span className="text-emerald-400">{(result.score * 100).toFixed(0)}% fit</span>
              </div>

              <div className="absolute bottom-2 right-2 bg-black/80 px-2 py-0.5 rounded-md text-[10px] font-mono text-white flex items-center gap-1">
                <Clock className="w-3 h-3 text-slate-400" />
                <span>{Math.round(result.duration || 10)}s</span>
              </div>

              <button
                onClick={() => setActivePreview(result)}
                className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity"
              >
                <div className="w-10 h-10 rounded-full bg-blue-600/90 flex items-center justify-center shadow-lg">
                  <Play className="w-5 h-5 fill-white ml-0.5" />
                </div>
              </button>
            </div>

            <div className="p-3.5 flex-1 flex flex-col justify-between gap-2 text-xs">
              <div>
                <span className="font-bold text-[var(--text-primary)] block mb-1">
                  Clip #{result.video_id} &bull; {result.creator || 'Pixabay'}
                </span>
                <p className="text-[11px] text-[var(--text-muted)] line-clamp-2">
                  Tags: {result.tags.slice(0, 5).join(', ')}
                </p>
              </div>

              <div className="p-2 rounded bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[10px] text-[var(--text-secondary)]">
                <span className="font-semibold text-blue-500 block mb-0.5">Editorial Fit:</span>
                Provides visual contrast suitable for {editorialIntent}.
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Modal Preview */}
      {activePreview && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl shadow-2xl p-5 max-w-3xl w-full flex flex-col gap-3">
            <div className="flex items-center justify-between pb-2 border-b border-[var(--border-subtle)] text-xs">
              <span className="font-bold text-[var(--text-primary)]">
                Candidate Clip #{activePreview.video_id}
              </span>
              <button
                onClick={() => setActivePreview(null)}
                className="px-2.5 py-1 rounded bg-[var(--bg-card)] text-[var(--text-secondary)]"
              >
                Close
              </button>
            </div>
            <div className="aspect-video bg-black rounded-lg overflow-hidden">
              <video
                src={mediaUrl(activePreview.video_url)}
                autoPlay
                controls
                playsInline
                className="w-full h-full object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
