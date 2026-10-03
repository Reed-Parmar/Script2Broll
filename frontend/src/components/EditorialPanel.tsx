import type { EditorialIntentResult } from '../api/client'

/** How the script line was interpreted, and the visual query that was searched. */
export default function EditorialPanel({ editorial }: { editorial: EditorialIntentResult }) {
  const rows: [string, string][] = [
    ['Topic', editorial.topic],
    ['Visual role', editorial.visual_role],
    ['Visual description', editorial.visual_description],
  ]
  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Editorial intent</span>
        <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800">
          {editorial.editorial_intent.replace('_', ' ')}
        </span>
      </div>
      <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-slate-500">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        <dt className="text-slate-500">Searched for</dt>
        <dd>
          <code className="rounded bg-white px-1 text-slate-800">{editorial.retrieval_query}</code>
        </dd>
      </dl>
    </div>
  )
}
