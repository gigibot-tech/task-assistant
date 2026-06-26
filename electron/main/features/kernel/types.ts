import type { DeviationResult } from '../../activityAnalysis'
import type { ProbeRunResult } from '../../subtaskProbe/subtaskProbe'
import type { FeatureContext, FeatureId } from '../../../../src/shared/kernel/types'
import type { FeatureBus } from './bus'

export type { FeatureContext, FeatureId }

export interface KernelDeps {
  sendNotification: (payload: Record<string, unknown>) => void
  showNativeNotification: (opts: {
    title: string
    body: string
    subtitle?: string
  }) => Promise<unknown>
  shouldSendAlert: (key: string, cooldownMs: number) => boolean
}

export interface FeatureModule {
  id: FeatureId | 'workplace' | 'semanticSorter' | 'review'
  order: number
  alwaysOn?: boolean
  hooks?: {
    'probe.prompt'?: (ctx: FeatureContext) => string
    'probe.result'?: (ctx: FeatureContext, result: ProbeRunResult) => ProbeRunResult
    'focus.prompt'?: (ctx: FeatureContext) => string
    'focus.result'?: (ctx: FeatureContext, result: DeviationResult) => DeviationResult
    'focus.after'?: (ctx: FeatureContext) => void
  }
  onRegister?: (bus: FeatureBus, deps: KernelDeps) => void
}
