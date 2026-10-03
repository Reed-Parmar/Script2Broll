import { mediaUrl, type SearchResult } from '../api/client'

function formatDuration(seconds: number | null) {
  if (seconds == null) return '–'
  const s = Math.round(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function ResultCard({ result, rank, note }: { result: SearchResult; rank: number; note?: string }) {
  return (
    <li className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <video
        className="aspect-video w-full bg-slate-900 object-cover"
        src={mediaUrl(result.video_url)}
        poster={mediaUrl(result.thumbnail_url)}
        preload="none"
        controls
        muted
        loop
        playsInline
        onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
        onMouseLeave={(e) => e.currentTarget.pause()}
      />
      <div className="space-y-1 p-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="font-medium">
            #{rank} · score {result.score.toFixed(3)}
          </span>
          <span className="text-slate-500">{formatDuration(result.duration)}</span>
        </div>
        <div className="text-slate-500">
          <a href={result.source_url} target="_blank" rel="noreferrer" className="underline hover:text-slate-800">
            {result.source} #{result.source_id}
          </a>
          {result.creator && <> · by {result.creator}</>}
          {result.width && result.height && (
            <>
              {' '}
              · {result.width}×{result.height}
            </>
          )}
        </div>
        {result.tags.length > 0 && <div className="truncate text-xs text-slate-400">{result.tags.join(', ')}</div>}
        {note && <div className="truncate text-xs text-indigo-700">{note}</div>}
      </div>
    </li>
  )
}
