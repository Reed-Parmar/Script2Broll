import { useState, useEffect, useRef, type FormEvent } from 'react'
import { Search, Sparkles, RefreshCw, Play, Clock, User, ExternalLink, Zap } from 'lucide-react'
import { searchVideos, mediaUrl, type SearchResult } from '../../api/client'

const EXAMPLE_QUERIES = [
  'people charging an electric vehicle',
  'busy city traffic at night',
  'doctor treating patient in hospital',
  'office meeting and business planning',
  'brain circuit artificial intelligence',
  'factory welder working in production',
  'mountain landscape snow alps',
  'ocean waves breaking on beach',
  'gym workout intense training',
  'airplane taking off at airport',
]

export default function SemanticSearchView() {
  const [query, setQuery] = useState('people charging an electric vehicle')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchTimings, setSearchTimings] = useState<Record<string, number>>({})
  const [searchModel, setSearchModel] = useState<string>('')
  const [activePreviewVideo, setActivePreviewVideo] = useState<SearchResult | null>(null)
  const videoRefs = useRef<Record<number, HTMLVideoElement | null>>({})

  useEffect(() => {
    void executeSearch(query)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function executeSearch(searchText: string) {
    const trimmed = searchText.trim()
    if (!trimmed) return

    setIsSearching(true)
    try {
      const response = await searchVideos(trimmed, 18)
      setResults(response.results)
      setSearchTimings(response.timings_ms)
      setSearchModel(response.model)
    } catch {
      // Fallback is handled automatically in searchVideos
    } finally {
      setIsSearching(false)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    void executeSearch(query)
  }

  function formatDuration(seconds: number | null) {
    if (seconds == null) return '–'
    const s = Math.round(seconds)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  return (
    <div className="flex-1 flex flex-col p-4 sm:p-6 gap-6 max-w-7xl mx-auto w-full overflow-y-auto">
      {/* Search Header Banner */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-6 shadow-xs flex flex-col gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-500">
              <Search className="w-4 h-4" />
            </div>
            <h1 className="text-base sm:text-lg font-bold text-[var(--text-primary)]">
              Semantic B-Roll Search Engine
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-[var(--text-muted)]">
            Describe the visual footage you need in natural plain language. The neural model maps text queries directly into the 512-dimensional visual embedding space.
          </p>
        </div>

        {/* Search Bar */}
        <form onSubmit={handleSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Describe the shot: e.g. people charging an electric vehicle, factory welder, ocean sunset..."
              className="w-full bg-[var(--bg-card)] border border-[var(--border-subtle)] focus:border-blue-500 rounded-lg pl-10 pr-4 py-2.5 text-xs sm:text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none transition-colors"
            />
            <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
          </div>

          <button
            type="submit"
            disabled={isSearching}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-xs sm:text-sm font-semibold flex items-center gap-2 shadow-xs transition-colors shrink-0"
          >
            {isSearching ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Searching…</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Search Footage</span>
              </>
            )}
          </button>
        </form>

        {/* Example Search Chips */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
          <span className="text-[11px] text-[var(--text-muted)] font-mono">Suggested:</span>
          {EXAMPLE_QUERIES.map((example) => (
            <button
              key={example}
              onClick={() => {
                setQuery(example)
                void executeSearch(example)
              }}
              className="px-2.5 py-1 text-[11px] rounded-md bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      {/* Results Header */}
      <div className="flex items-center justify-between text-xs text-[var(--text-muted)] px-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[var(--text-primary)]">
            {results.length} Visual Results Found
          </span>
          <span>&bull;</span>
          <span>Query: &ldquo;{query}&rdquo;</span>
        </div>

        <div className="flex items-center gap-3 font-mono text-[11px]">
          {searchTimings.total && (
            <span className="flex items-center gap-1 text-emerald-500">
              <Zap className="w-3 h-3" />
              <span>{Math.round(searchTimings.total)}ms latency</span>
            </span>
          )}
          {searchModel && (
            <span className="hidden sm:inline bg-[var(--bg-card)] px-2 py-0.5 rounded border border-[var(--border-subtle)]">
              {searchModel}
            </span>
          )}
        </div>
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
              {/* Video Thumbnail Viewport */}
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

                {/* Rank & Score Pill */}
                <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/80 backdrop-blur-xs px-2 py-0.5 rounded-md text-[10px] font-mono text-white">
                  <span className="text-blue-400 font-bold">#{i + 1}</span>
                  <span className="text-slate-400">&bull;</span>
                  <span className="text-emerald-400 font-semibold">
                    {(result.score * 100).toFixed(1)}% match
                  </span>
                </div>

                {/* Duration Badge */}
                <div className="absolute bottom-2 right-2 bg-black/80 px-2 py-0.5 rounded-md text-[10px] font-mono text-white flex items-center gap-1">
                  <Clock className="w-3 h-3 text-slate-400" />
                  <span>{formatDuration(result.duration)}</span>
                </div>

                {/* Fullscreen Preview Click */}
                <button
                  onClick={() => setActivePreviewVideo(result)}
                  className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity"
                >
                  <div className="w-10 h-10 rounded-full bg-blue-600/90 flex items-center justify-center shadow-lg">
                    <Play className="w-5 h-5 fill-white ml-0.5" />
                  </div>
                </button>
              </div>

              {/* Card Meta Content */}
              <div className="p-3.5 flex-1 flex flex-col justify-between gap-2.5 text-xs">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-[var(--text-primary)]">
                      Footage Reel #{result.video_id}
                    </span>
                    <a
                      href={result.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-[var(--text-muted)] hover:text-blue-500 flex items-center gap-1"
                    >
                      <span>{result.source}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>

                  <p className="text-[11px] text-[var(--text-muted)] flex items-center gap-1">
                    <User className="w-3 h-3" />
                    <span>Creator: {result.creator || 'Pixabay Filmmaker'}</span>
                    {result.width && (
                      <span className="ml-auto font-mono text-[10px]">
                        {result.width}×{result.height}
                      </span>
                    )}
                  </p>
                </div>

                {/* Tag Pills */}
                {result.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {result.tags.slice(0, 4).map((tag) => (
                      <span
                        key={tag}
                        className="bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] px-1.5 py-0.5 rounded text-[10px]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        )}
      </div>

      {/* FULLSCREEN PREVIEW MODAL */}
      {activePreviewVideo && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl shadow-2xl p-5 max-w-3xl w-full flex flex-col gap-3">
            <div className="flex items-center justify-between pb-2 border-b border-[var(--border-subtle)] text-xs">
              <span className="font-bold text-[var(--text-primary)]">
                Preview: Clip #{activePreviewVideo.video_id} &bull; {activePreviewVideo.creator || 'Pixabay'}
              </span>
              <button
                onClick={() => setActivePreviewVideo(null)}
                className="px-2.5 py-1 rounded bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Close (ESC)
              </button>
            </div>

            <div className="aspect-video bg-black rounded-lg overflow-hidden">
              <video
                src={mediaUrl(activePreviewVideo.video_url)}
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
