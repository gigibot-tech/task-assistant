import { useEffect, useMemo, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { ProbeResult, SoftwarePhase, StuckTrigger, ThinkingBand } from '../lib/subtaskTypes'
import { THINKING_BAND_LABELS, buildOutcome } from '../lib/subtaskTypes'
import type { TaskBreakdownItem } from '../lib/taskBreakdownTypes'
import {
  breakdownToTaskSubtasks,
  createTechnicalBreakdownItem,
  resolveTaskBreakdown,
  upsertBreakdownFromProbe
} from '../lib/breakdownHelpers'
import { recordStuckEvent, runSubtaskProbe, setActiveSubtask, startOrResumeTaskWork } from '../lib/electron-api'
import type { Task } from '../store/taskStore'
import { useTaskStore } from '../store/taskStore'
import { PHASE_LABELS } from '../features/softwarePhases/types'

function isExtractInputStep(workPhase?: SoftwarePhase): boolean {
  return workPhase === 'extract'
}

export interface SubtaskProbeModalProps {
  taskId: string
  taskTitle: string
  taskDay?: number
  primeDay?: number | null
  trigger: StuckTrigger
  workPhase?: SoftwarePhase
  /** @deprecated Use existingItems */
  existingSubtasks?: import('../lib/subtaskTypes').TaskSubtask[]
  existingItems?: TaskBreakdownItem[]
  activeSubtaskId?: string | null
  onAccept: (updates: {
    task_breakdown: TaskBreakdownItem[]
    active_subtask_id: string
    probe_must_code_by?: string
    drive_acknowledged_primes?: number[]
    phase_balance?: Task['phase_balance']
    work_phase?: SoftwarePhase
  }) => Promise<void>
  onLater: () => void
  onWorkTimerStarted?: () => void
}

type Step = 'band' | 'input' | 'result'

function bandRequired(trigger: StuckTrigger): boolean {
  return trigger !== 'prime_day'
}

export default function SubtaskProbeModal({
  taskId,
  taskTitle,
  taskDay,
  primeDay,
  trigger,
  workPhase,
  existingSubtasks = [],
  existingItems,
  activeSubtaskId,
  onAccept,
  onLater,
  onWorkTimerStarted
}: SubtaskProbeModalProps) {
  const { loadTasks, setActiveTask } = useTaskStore()
  const existingBreakdown =
    existingItems ??
    (existingSubtasks.length > 0
      ? existingSubtasks.map((st, idx) =>
          createTechnicalBreakdownItem({
            id: st.id,
            title: st.title,
            input: st.input,
            output: st.output,
            transformation: st.transformation,
            outcome: st.outcome,
            status: st.status,
            source: st.source === 'ai_sme' ? 'ai_sme' : 'user',
            phase: st.phase,
            order: idx,
            sme_validation_id: st.sme_validation_id,
            extraction_of_subtask_id: st.extraction_of_subtask_id,
            extraction_checks: st.extraction_checks,
            ai_estimate_minutes: st.ai_estimate_minutes
          })
        )
      : [])
  const existingSubtaskCompat = breakdownToTaskSubtasks(existingBreakdown)
  const [step, setStep] = useState<Step>(bandRequired(trigger) ? 'band' : 'input')
  const [thinkingBand, setThinkingBand] = useState<ThinkingBand | null>(null)
  const [userLine, setUserLine] = useState('')
  const [validateUseful, setValidateUseful] = useState(false)
  const [validateExplainable, setValidateExplainable] = useState(false)
  const [validateE2e, setValidateE2e] = useState(false)
  const [loading, setLoading] = useState(false)
  const [probeError, setProbeError] = useState<string | null>(null)
  const [probe, setProbe] = useState<ProbeResult | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editInput, setEditInput] = useState('')
  const [editOutput, setEditOutput] = useState('')
  const [editTransformation, setEditTransformation] = useState('')
  const [saving, setSaving] = useState(false)
  const [extractUseful, setExtractUseful] = useState(false)
  const [extractExplainable, setExtractExplainable] = useState(false)
  const [extractE2e, setExtractE2e] = useState(false)

  const isExtractFlow = workPhase === 'extract' || probe?.extraction_ready
  const extractInputStep = isExtractInputStep(workPhase)

  const headerLabel = useMemo(() => {
    if (primeDay != null && taskDay != null) {
      return `Day ${taskDay} · Prime ${primeDay} · Probe`
    }
    if (trigger === 'deviation') return 'Stuck — deviation probe'
    if (trigger === 'stale') return 'Stuck — progress probe'
    return "I'm stuck — probe"
  }, [primeDay, taskDay, trigger])

  useEffect(() => {
    setStep(bandRequired(trigger) ? 'band' : 'input')
    setThinkingBand(null)
    setProbe(null)
    setLoading(false)
    setSaving(false)
    setProbeError(null)
    
    // Auto-fill from previous day's saved challenge request if it exists
    const today = new Date().toISOString().split('T')[0]
    const challengeRequestKey = `challenge_requested_${taskId}_${today}`
    const savedRequest = localStorage.getItem(challengeRequestKey)
    
    if (savedRequest) {
      try {
        const parsed = JSON.parse(savedRequest)
        // Auto-fill the user line if we have it from a previous attempt
        if (parsed.userLine) {
          setUserLine(parsed.userLine)
        }
        if (parsed.thinkingBand) {
          setThinkingBand(parsed.thinkingBand)
        }
      } catch (err) {
        console.error('Failed to parse saved challenge request:', err)
      }
    } else {
      setUserLine('')
    }
  }, [taskId, trigger, primeDay])

  const applyProbeToEdit = (result: ProbeResult) => {
    const st = result.suggested_subtask
    setEditTitle(st.title)
    setEditInput(result.input || st.input)
    setEditOutput(result.output || st.output)
    setEditTransformation(result.transformation || st.transformation)
  }

  const handleRunProbe = async () => {
    setLoading(true)
    setProbeError(null)
    try {
      const today = new Date().toISOString().split('T')[0]
      const challengeRequestKey = `challenge_requested_${taskId}_${today}`

      let probeUserLine: string | undefined
      if (extractInputStep) {
        const validations = []
        if (validateUseful) validations.push('useful')
        if (validateExplainable) validations.push('explainable')
        if (validateE2e) validations.push('e2e')
        probeUserLine =
          validations.length > 0 ? `Validating: ${validations.join(', ')}` : undefined
      } else {
        probeUserLine = userLine.trim() || undefined
      }

      localStorage.setItem(
        challengeRequestKey,
        JSON.stringify({
          taskId,
          taskTitle,
          requestedAt: new Date().toISOString(),
          day: taskDay,
          primeDay,
          trigger,
          userLine: probeUserLine,
          thinkingBand: thinkingBand ?? undefined
        })
      )

      const result = await runSubtaskProbe(taskId, {
        trigger,
        userLine: probeUserLine,
        thinkingBand: thinkingBand ?? undefined
      })
      setProbe(result)
      applyProbeToEdit(result)
      setStep('result')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Probe failed'
      console.error('Probe failed:', err)
      setProbeError(message)
    } finally {
      setLoading(false)
    }
  }

  const handleAccept = async () => {
    if (!probe) return
    setSaving(true)
    try {
      const source =
        trigger === 'prime_day' ? 'prime_day' : trigger === 'manual' ? 'stuck' : 'stuck'

      const subtaskId = uuidv4()
      const outcome =
        buildOutcome(editInput, editOutput, editTransformation) ||
        probe.suggested_subtask.outcome

      const subtaskPhase: SoftwarePhase =
        workPhase === 'extract' || probe.extraction_ready
          ? 'core'
          : (probe.recommended_phase as SoftwarePhase) || workPhase || 'playground'

      const parentPlaygroundId =
        workPhase === 'extract'
          ? existingSubtaskCompat.find(
              (s) => s.id === activeSubtaskId && s.phase === 'playground'
            )?.id ??
            existingSubtaskCompat.find(
              (s) => s.phase === 'playground' && s.validated_with_real_input
            )?.id
          : undefined

      const newItem = createTechnicalBreakdownItem({
        id: subtaskId,
        title: editTitle.trim() || probe.suggested_subtask.title,
        input: editInput.trim(),
        output: editOutput.trim(),
        transformation: editTransformation.trim(),
        outcome,
        status: 'active',
        source,
        phase: subtaskPhase,
        order: existingBreakdown.length,
        extraction_of_subtask_id: parentPlaygroundId,
        extraction_checks:
          isExtractFlow || probe.extraction_ready
            ? { useful: extractUseful, explainable: extractExplainable, e2e: extractE2e }
            : undefined
      })

      if (thinkingBand && bandRequired(trigger)) {
        await recordStuckEvent(taskId, {
          trigger,
          thinking_band: thinkingBand,
          subtask_id: subtaskId,
          ai_challenge: probe.challenge,
          ai_suggested_subtask: newItem.title
        })
      }

      await setActiveSubtask(taskId, subtaskId)

      const updates: Parameters<typeof onAccept>[0] = {
        task_breakdown: upsertBreakdownFromProbe(existingBreakdown, newItem, subtaskId),
        active_subtask_id: subtaskId,
        probe_must_code_by: probe.must_code_by
      }

      if (parentPlaygroundId && extractUseful && extractExplainable && extractE2e) {
        updates.phase_balance = { extract_events_7d: 1 }
        updates.work_phase = 'core'
      }

      if (primeDay != null) {
        updates.drive_acknowledged_primes = [primeDay]
      }

      await onAccept(updates)

      try {
        const workTask = await startOrResumeTaskWork(taskId)
        await loadTasks()
        if (workTask && typeof workTask === 'object' && 'id' in workTask) {
          setActiveTask(workTask as Task)
        }
        onWorkTimerStarted?.()
      } catch (err) {
        console.error('Failed to start/resume task after probe:', err)
      }
    } finally {
      setSaving(false)
    }
  }

  const mustCodeCountdown = useMemo(() => {
    if (!probe?.must_code_by) return null
    const target = new Date(probe.must_code_by).getTime()
    const min = Math.max(0, Math.round((target - Date.now()) / 60000))
    return `${min} min`
  }, [probe?.must_code_by])

  const bands = Object.entries(THINKING_BAND_LABELS) as [ThinkingBand, string][]

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4 bg-black/50"
      role="dialog"
      aria-labelledby="subtask-probe-title"
    >
      <div className="w-full max-w-lg bg-gray-900 border border-violet-700/60 rounded-xl shadow-2xl p-5 animate-slide-up max-h-[90vh] overflow-y-auto">
        <div className="mb-4">
          <p className="text-xs text-violet-300 font-medium uppercase tracking-wide">
            {headerLabel}
          </p>
          <h2 id="subtask-probe-title" className="text-lg font-semibold text-white mt-0.5 truncate">
            {taskTitle}
          </h2>
          <p className="text-sm text-gray-400 mt-1 italic">
            Clarify by acting — not by thinking longer.
          </p>
          {workPhase && (
            <p className="text-xs text-teal-400 mt-1">Phase: {PHASE_LABELS[workPhase]}</p>
          )}
          {probe?.recommended_phase && !workPhase && (
            <p className="text-xs text-teal-400 mt-1">
              Suggested phase:{' '}
              {PHASE_LABELS[probe.recommended_phase as SoftwarePhase] ?? probe.recommended_phase}
            </p>
          )}
        </div>

        {step === 'band' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-300">
              How long were you thinking/designing before coding?
            </p>
            <p className="text-xs text-gray-500">
              Think a lot, build little? Pick a band — then describe what you are stuck on.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {bands.map(([band, label]) => (
                <button
                  key={band}
                  type="button"
                  onClick={() => {
                    setThinkingBand(band)
                    setStep('input')
                  }}
                  className="px-3 py-2 bg-gray-800 hover:bg-violet-900/50 border border-gray-600 hover:border-violet-600 rounded-lg text-sm text-gray-200"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 'input' && (
          <div className="space-y-3">
            {thinkingBand && (
              <p className="text-xs text-violet-300">
                Band: {THINKING_BAND_LABELS[thinkingBand]}
              </p>
            )}
            {extractInputStep ? (
              <>
                <p className="block text-sm text-gray-300">
                  Which materialization checks apply to this extract?
                </p>
                <div className="space-y-2 bg-gray-800/50 border border-gray-700 rounded-lg p-3">
                  <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:text-white">
                    <input
                      type="checkbox"
                      checked={validateUseful}
                      onChange={(e) => setValidateUseful(e.target.checked)}
                      className="w-4 h-4"
                    />
                    Useful again?
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:text-white">
                    <input
                      type="checkbox"
                      checked={validateExplainable}
                      onChange={(e) => setValidateExplainable(e.target.checked)}
                      className="w-4 h-4"
                    />
                    Explainable simply?
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:text-white">
                    <input
                      type="checkbox"
                      checked={validateE2e}
                      onChange={(e) => setValidateE2e(e.target.checked)}
                      className="w-4 h-4"
                    />
                    Works end-to-end?
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRunProbe()}
                  disabled={
                    loading ||
                    (!validateUseful && !validateExplainable && !validateE2e)
                  }
                  className="w-full px-3 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                >
                  {loading ? 'Probing…' : 'Get AI challenge'}
                </button>
              </>
            ) : (
              <>
                <label className="block text-sm text-gray-300" htmlFor="probe-user-line">
                  What are you stuck on or trying to validate right now?
                </label>
                <textarea
                  id="probe-user-line"
                  value={userLine}
                  onChange={(e) => setUserLine(e.target.value)}
                  placeholder="e.g. whether the auth flow works with real tokens, or which file to edit next…"
                  rows={3}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-gray-100 placeholder:text-gray-500"
                />
                <button
                  type="button"
                  onClick={() => void handleRunProbe()}
                  disabled={loading}
                  className="w-full px-3 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                >
                  {loading ? 'Probing…' : 'Get AI challenge'}
                </button>
              </>
            )}
            {probeError && (
              <p className="text-xs text-red-300 bg-red-950/50 border border-red-800/60 rounded px-2 py-1.5">
                {probeError}
              </p>
            )}
          </div>
        )}

        {step === 'result' && probe && (
          <div className="space-y-3">
            <p className="text-sm text-violet-200 font-medium">{probe.challenge}</p>
            <p className="text-xs text-gray-400">{probe.stupid_version_hint}</p>
            {mustCodeCountdown != null && (
              <p className="text-xs text-amber-300">
                Must write code by: {new Date(probe.must_code_by).toLocaleTimeString()} (
                {mustCodeCountdown} left)
              </p>
            )}
            <p className="text-xs text-gray-500">{probe.build_one_now}</p>

            {(isExtractFlow || probe.extraction_ready) && (
              <div className="space-y-2 pt-2 border-t border-teal-800/50">
                <p className="text-xs text-teal-300 font-medium">Materialization checks</p>
                {probe.materialization_checks && (
                  <p className="text-[10px] text-gray-500">
                    {probe.materialization_checks.useful} · {probe.materialization_checks.explainable} ·{' '}
                    {probe.materialization_checks.e2e}
                  </p>
                )}
                <label className="flex items-center gap-2 text-xs text-gray-300">
                  <input type="checkbox" checked={extractUseful} onChange={(e) => setExtractUseful(e.target.checked)} />
                  Useful again?
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-300">
                  <input
                    type="checkbox"
                    checked={extractExplainable}
                    onChange={(e) => setExtractExplainable(e.target.checked)}
                  />
                  Explainable simply?
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-300">
                  <input type="checkbox" checked={extractE2e} onChange={(e) => setExtractE2e(e.target.checked)} />
                  Works end-to-end?
                </label>
              </div>
            )}

            <div className="space-y-2 pt-2 border-t border-gray-700">
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Subtask title"
                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm"
              />
              <input
                value={editInput}
                onChange={(e) => setEditInput(e.target.value)}
                placeholder="Input (e.g. PDF file)"
                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm"
              />
              <input
                value={editOutput}
                onChange={(e) => setEditOutput(e.target.value)}
                placeholder="Output (e.g. structured JSON)"
                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm"
              />
              <input
                value={editTransformation}
                onChange={(e) => setEditTransformation(e.target.value)}
                placeholder="Transformation (e.g. parse + extract)"
                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm"
              />
            </div>
          </div>
        )}

        <div className="flex gap-2 mt-5">
          <button
            type="button"
            onClick={onLater}
            disabled={saving}
            className="flex-1 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 disabled:opacity-50"
          >
            {step === 'result' ? 'Skip' : 'Later'}
          </button>
          {step === 'result' && probe && (
            <button
              type="button"
              onClick={() => void handleAccept()}
              disabled={
                saving ||
                !editInput.trim() ||
                !editOutput.trim() ||
                !editTransformation.trim() ||
                ((isExtractFlow || probe.extraction_ready) &&
                  (!extractUseful || !extractExplainable || !extractE2e))
              }
              className="flex-[2] px-3 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Accept & set active'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
