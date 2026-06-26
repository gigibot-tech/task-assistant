import type { DeviationResult } from '../../../electron/main/activityAnalysis'

export type FeatureId =
  | 'subtaskProbe'
  | 'softwarePhases'
  | 'phaseGitSignals'
  | 'phaseBalanceAlerts'
  | 'semanticSorter'
  | 'review'
  | 'smeValidator'

export type FeatureFlags = Record<FeatureId, boolean>

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  subtaskProbe: true,
  softwarePhases: true,
  phaseGitSignals: true,
  phaseBalanceAlerts: true,
  semanticSorter: true,
  review: true,
  smeValidator: true
}

export type PipelineHook =
  | 'probe.prompt'
  | 'probe.result'
  | 'focus.prompt'
  | 'focus.result'
  | 'focus.after'

export type DomainEvent =
  | 'focus.off_task'
  | 'focus.check_complete'
  | 'subtask.accepted'
  | 'deviation.alert'
  | 'stuck_probe.offer'
  | 'phase.alert'

export interface FeatureContext {
  task: Record<string, unknown>
  flags: FeatureFlags
  settings?: Record<string, unknown>
  trigger?: string
  focusResult?: DeviationResult
  probeInput?: { userLine?: string; thinkingBand?: string }
  parsed?: Record<string, unknown>
}

export function mergeFeatureFlags(partial?: Partial<FeatureFlags>): FeatureFlags {
  return { ...DEFAULT_FEATURE_FLAGS, ...partial }
}

export function isFeatureEnabled(flags: FeatureFlags, id: FeatureId): boolean {
  if (id === 'phaseGitSignals' || id === 'phaseBalanceAlerts') {
    return flags.softwarePhases && flags[id]
  }
  return flags[id]
}

export function getFeatureFlagsFromSettings(settings?: {
  featureFlags?: Partial<FeatureFlags>
}): FeatureFlags {
  return mergeFeatureFlags(settings?.featureFlags)
}
