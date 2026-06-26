import type { FeatureFlags } from './types'
import { isFeatureEnabled } from './types'

export function softwarePhasesActive(flags: FeatureFlags): boolean {
  return isFeatureEnabled(flags, 'softwarePhases')
}

export function subtaskProbeActive(flags: FeatureFlags): boolean {
  return isFeatureEnabled(flags, 'subtaskProbe')
}

export function semanticSorterActive(flags: FeatureFlags): boolean {
  return isFeatureEnabled(flags, 'semanticSorter')
}

export function reviewActive(flags: FeatureFlags): boolean {
  return isFeatureEnabled(flags, 'review')
}

export function smeValidatorActive(flags: FeatureFlags): boolean {
  return isFeatureEnabled(flags, 'smeValidator')
}
