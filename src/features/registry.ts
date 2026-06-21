import type { FeatureFlags } from './types'
import { isFeatureEnabled } from './types'

export function softwarePhasesActive(flags: FeatureFlags): boolean {
  return isFeatureEnabled(flags, 'softwarePhases')
}

export function subtaskProbeActive(flags: FeatureFlags): boolean {
  return isFeatureEnabled(flags, 'subtaskProbe')
}
