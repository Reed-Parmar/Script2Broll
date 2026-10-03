import { useState, useEffect, useRef } from 'react'
import { Sparkles, SlidersHorizontal, Play, Clock, CheckCircle2, RefreshCw } from 'lucide-react'
import { searchVideos, mediaUrl, type SearchResult } from '../../api/client'

const SAMPLE_EDITORIAL_PROMPTS = [
  {
    sentence: 'However, charging infrastructure remains critically limited, creating anxiety for everyday drivers.',
    intent: 'Problem / Bottleneck',
    tone: 'Urgent & Congested',
    query: 'charging plug electric car charging station traffic',
  },
  {
    sentence: 'Artificial intelligence models analyze millions of diagnostic scans to pinpoint anomalies.',
    intent: 'Solution / High-Tech',
    tone: 'Clinical & High-Tech',
    query: 'doctor x-ray hospital technology diagnosis medicine',
  },
  {
    sentence: 'Global capital markets shift in milliseconds as high-frequency algorithms execute trades.',
    intent: 'Escalation / Tension',
    tone: 'Fast-Paced & Analytical',
    query: 'stock market financial exchange graph profits analysis',
  },
  {
    sentence: 'Across pristine alpine valleys, clean renewable wind energy powers regional transit.',
    intent: 'Resolution / Hope',
    tone: 'Cinematic & Expansive',
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
  const videoRefs = useRef<Record<number, HTMLVideoElement | null>>({})

  useEffect(() => {
    void executeEditorialSearch(statement, editorialIntent, visualTone)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function executeEditorialSearch(stmt: string, intent: string, tone: string) {
    setIsSearching(true)
    // Construct rich editorial retrieval query
    let queryTerms = stmt
    if (intent.includes('Problem')) queryTerms += ' problem struggle traffic delay'
    if (intent.includes('Solution')) queryTerms += ' solution tech modern smart'
    if (tone.includes('High-Tech')) queryTerms += ' technology computer electronics'
    if (tone.includes('Congested')) queryTerms += ' city traffic cars crowded'
    if (tone.includes('Cinematic')) queryTerms += ' nature landscape open'

    try {
      const resp = await searchVideos(queryTerms, 12)
      setResults(resp.results)
    } catch {
      // Handled in searchVideos
    } finally {
      setIsSearching(false)
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
              <option value="Problem / Bottleneck">Problem / Conflict / Bottleneck</option>
              <option value="Hook / Introduction">Hook / Context / Atmosphere</option>
              <option value="Solution / High-Tech">Solution / Breakthrough / Tech</option>
              <option value="Escalation / Tension">Escalation / Momentum / Action</option>
              <option value="Resolution / Hope">Resolution / Harmony / Conclusion</option>
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
              <option value="Urgent & Congested">Urgent & Congested</option>
              <option value="Clinical & High-Tech">Clinical & Clean High-Tech</option>
              <option value="Cinematic & Expansive">Cinematic & Expansive Landscape</option>
              <option value="Fast-Paced & Analytical">Fast-Paced & Analytical Momentum</option>
              <option value="Human & Collaborative">Human, Warm & Collaborative</option>
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
            Synthesized Visual Directive: <strong className="text-[var(--text-primary)] font-medium">&ldquo;{visualTone}&rdquo;</strong> supporting dramatic role <strong className="text-[var(--text-primary)] font-medium">&ldquo;{editorialIntent}&rdquo;</strong>.
          </span>
        </div>
        <span className="text-[11px] font-mono text-[var(--text-muted)] shrink-0 hidden sm:inline">
          {results.length} ranked matches
        </span>
      </div>

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
