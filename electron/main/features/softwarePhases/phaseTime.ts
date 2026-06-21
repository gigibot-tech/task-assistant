import type { PhaseBalance } from '../../../../src/features/softwarePhases/types'
import { defaultPhaseBalance } from '../../../../src/features/softwarePhases/types'
import type { SoftwarePhase } from '../../../../src/features/softwarePhases/types'

const MINUTES_PER_FOCUS_TICK = 5

export function getPhaseBalance(task: { phase_balance?: PhaseBalance }): PhaseBalance {
  return task.phase_balance ?? defaultPhaseBalance()
}

export function recordPhaseFocusMinutes(
  balance: PhaseBalance,
  workPhase: SoftwarePhase | undefined,
  minutes = MINUTES_PER_FOCUS_TICK
): PhaseBalance {
  const next = { ...balance }
  if (workPhase === 'core' || workPhase === 'extract') {
    next.core_minutes_7d = (next.core_minutes_7d ?? 0) + minutes
  } else {
    next.playground_minutes_7d = (next.playground_minutes_7d ?? 0) + minutes
  }
  return next
}

export function recordExtractEvent(balance: PhaseBalance): PhaseBalance {
  return {
    ...balance,
    extract_events_7d: (balance.extract_events_7d ?? 0) + 1
  }
}

export function isPhaseImbalanced(balance: PhaseBalance): boolean {
  const pg = balance.playground_minutes_7d ?? 0
  const core = balance.core_minutes_7d ?? 0
  const extracts = balance.extract_events_7d ?? 0
  const gitImbalance = (balance.imbalance_score ?? 0) >= 0.6
  return (pg >= 60 && extracts === 0 && pg > core * 2) || gitImbalance
}
