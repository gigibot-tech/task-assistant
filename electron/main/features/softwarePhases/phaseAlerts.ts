import type { PhaseBalance } from '../../../../src/features/softwarePhases/types'
import { isPhaseImbalanced } from './phaseTime'

export interface PhaseAlertPayload {
  type: 'phase_imbalance' | 'extract_due' | 'phase_mismatch'
  taskId: string
  taskTitle: string
  message: string
  work_phase?: string
}

export function checkPhaseImbalanceAlert(
  task: {
    id: string
    title: string
    work_phase?: string
    phase_balance?: PhaseBalance
    subtasks?: Array<{
      id: string
      status?: string
      validated_with_real_input?: boolean
      phase?: string
    }>
    active_subtask_id?: string | null
  },
  phaseBalanceAlertsEnabled: boolean
): PhaseAlertPayload | null {
  if (!phaseBalanceAlertsEnabled) return null

  const balance = task.phase_balance
  if (!balance) return null

  if (isPhaseImbalanced(balance)) {
    return {
      type: 'phase_imbalance',
      taskId: task.id,
      taskTitle: task.title,
      message:
        'Playground is dominating — extract one useful slice to core before more exploration.',
      work_phase: task.work_phase
    }
  }

  const active = task.subtasks?.find((s) => s.id === task.active_subtask_id)
  if (
    active?.phase === 'playground' &&
    active.validated_with_real_input &&
    !task.subtasks?.some(
      (s) =>
        s.phase === 'core' &&
        (s as { extraction_of_subtask_id?: string }).extraction_of_subtask_id === active.id
    )
  ) {
    return {
      type: 'extract_due',
      taskId: task.id,
      taskTitle: task.title,
      message: 'Playground subtask validated — time to extract to core.',
      work_phase: task.work_phase
    }
  }

  return null
}

export function phaseMismatchFooter(
  workPhase: string | undefined,
  phaseMismatch: boolean | undefined
): string | null {
  if (!phaseMismatch || !workPhase) return null
  if (workPhase === 'playground') {
    return 'You are in playground but screen looks like core-style architecture — sketch in playground or switch phase.'
  }
  return `Declared phase ${workPhase} does not match on-screen work.`
}
