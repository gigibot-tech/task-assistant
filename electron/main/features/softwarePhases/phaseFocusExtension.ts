import type { DeviationResult } from '../../activityAnalysis'
import type { SoftwarePhase } from '../../../../src/features/softwarePhases/types'

export function buildPhaseFocusExtension(workPhase?: string, subtaskPhase?: string): string {
  const phase = (workPhase as SoftwarePhase) || 'playground'
  const sub = subtaskPhase ? `Active subtask phase: ${subtaskPhase}.` : ''
  return `
Software work phase: ${phase}. ${sub}
Rules by phase:
- playground: messy spike/scripting counts as on-task; over_design is softer (probe still OK)
- core: over_design is NOT on-task; reward small composable code edits
- extract: on-task when refactoring toward extracting playground signal into core

Also classify:
- codebase_phase_match: boolean — does on-screen work match declared phase?
Include codebase_phase_match in JSON.`
}

export function adjustFocusForPhase(
  result: DeviationResult,
  workPhase: string | undefined,
  parsed: { codebase_phase_match?: boolean; work_mode?: string }
): DeviationResult & { codebase_phase_match?: boolean; phase_mismatch?: boolean } {
  const phase = (workPhase as SoftwarePhase) || 'playground'
  const workMode = parsed.work_mode || result.work_mode
  const phaseMatch = parsed.codebase_phase_match !== false

  let onTask = result.onTask
  let suggestion = result.suggestion

  if (phase === 'playground' && workMode === 'over_design') {
    onTask = true
  } else if (phase === 'core' && workMode === 'over_design') {
    onTask = false
    suggestion = `${suggestion} Core phase: stop designing — write the smallest working slice.`
  } else if (phase === 'extract' && (workMode === 'probe' || workMode === 'on_subtask')) {
    onTask = true
  }

  const phaseMismatch = !phaseMatch && workPhase != null
  if (phaseMismatch) {
    suggestion = `${suggestion} Phase mismatch: you declared ${phase} but screen looks different.`
  }

  return {
    ...result,
    onTask,
    suggestion,
    codebase_phase_match: phaseMatch,
    phase_mismatch: phaseMismatch
  }
}
