import { Check, Loader2, Sparkles, X } from 'lucide-react'
import type { GenerationStage } from '../../types/editor'

interface GenerationModalProps {
  isOpen: boolean
  stage: GenerationStage
  error?: string | null
  onClose: () => void
}

const STAGES = [
  { key: 'parsing', label: 'Analyzing script narrative structure' },
  { key: 'beats', label: 'Segmenting into editorial beats' },
  { key: 'visual_intent', label: 'Formulating visual intent & search directives' },
  { key: 'retrieving', label: 'Searching and matching B-roll footage' },
  { key: 'assembling', label: 'Building timeline sequence' },
]

export default function GenerationModal({
  isOpen,
  stage,
  error,
  onClose,
}: GenerationModalProps) {
  if (!isOpen) return null

  const isDone = stage === 'done'
  const isError = stage === 'error'

  function getStepState(stepKey: string) {
    const stageOrder = ['parsing', 'beats', 'visual_intent', 'retrieving', 'assembling', 'done']
    const currentIndex = stageOrder.indexOf(stage)
    const stepIndex = stageOrder.indexOf(stepKey)

    if (isError && currentIndex === stepIndex) return 'error'
    if (currentIndex > stepIndex || isDone) return 'completed'
    if (currentIndex === stepIndex) return 'current'
    return 'pending'
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-md bg-[#161820] border border-[#282c3c] rounded-lg shadow-2xl p-5 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#242735]">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-slate-100 uppercase tracking-wider">
                B-Roll Generation Sequence
              </h3>
              <p className="text-[11px] text-slate-400">
                AI Editorial Assistant Workflow
              </p>
            </div>
          </div>

          {(isDone || isError) && (
            <button
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-white rounded"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Steps List */}
        <div className="space-y-3 py-1 text-xs">
          {STAGES.map((s) => {
            const state = getStepState(s.key)

            return (
              <div key={s.key} className="flex items-center justify-between">
                <span
                  className={
                    state === 'completed'
                      ? 'text-slate-300'
                      : state === 'current'
                      ? 'text-blue-400 font-medium'
                      : 'text-slate-500'
                  }
                >
                  {s.label}
                </span>

                <div className="flex items-center justify-center w-5 h-5">
                  {state === 'completed' && (
                    <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                      <Check className="w-3 h-3 stroke-[2.5]" />
                    </span>
                  )}
                  {state === 'current' && (
                    <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                  )}
                  {state === 'pending' && (
                    <span className="w-2 h-2 rounded-full bg-[#2a2e3e]" />
                  )}
                  {state === 'error' && (
                    <span className="w-4 h-4 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center font-bold text-[10px]">
                      !
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Error Notice */}
        {error && (
          <div className="p-3 rounded bg-rose-950/40 border border-rose-800/50 text-rose-200 text-xs leading-relaxed">
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="pt-2 border-t border-[#242735] flex justify-end">
          {isDone ? (
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium transition-colors"
            >
              Open Edited Timeline
            </button>
          ) : isError ? (
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-[#202330] hover:bg-[#282c3c] text-slate-200 rounded text-xs font-medium transition-colors"
            >
              Close
            </button>
          ) : (
            <span className="text-[11px] text-slate-500 italic">
              Processing narrative and library assets…
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
