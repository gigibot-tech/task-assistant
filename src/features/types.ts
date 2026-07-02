export type {
  FeatureId,
  FeatureFlags,
  FeatureContext,
  PipelineHook,
  DomainEvent
} from '../shared/kernel/types'

export {
  DEFAULT_FEATURE_FLAGS,
  mergeFeatureFlags,
  isFeatureEnabled,
  getFeatureFlagsFromSettings
} from '../shared/kernel/types'

export const FEATURE_LABELS: Record<
  import('../shared/kernel/types').FeatureId,
  { label: string; tooltip: string }
> = {
  subtaskProbe: {
    label: 'Subtask probe & stuck flow',
    tooltip: 'AI probe modal, thinking bands, wasted-time stats, subtask panel'
  },
  softwarePhases: {
    label: 'Software phases (playground / core / extract)',
    tooltip: 'Logical phase mode: build messy in playground, keep clean in core, extract signal between them'
  },
  phaseGitSignals: {
    label: 'Git phase signals',
    tooltip: 'Read-only git log heuristics to suggest phase (requires software phases)'
  },
  phaseBalanceAlerts: {
    label: 'Phase balance alerts',
    tooltip: 'Remind when playground dominates without extraction (requires software phases)'
  },
  semanticSorter: {
    label: 'Desktop semantic sorter',
    tooltip: 'Sort Desktop/OneDrive inbox files with rules + Ollama review'
  },
  review: {
    label: 'Review workspace',
    tooltip: 'Multi-day file review schedule with checkmarks and date coloring'
  },
  smeValidator: {
    label: 'SME opinion validation',
    tooltip: 'Per-task expert opinion checks with timeline and subtask recommendations'
  },
  focusMonitor: {
    label: 'Screen capture',
    tooltip: 'Automatic background screenshots, history gallery, and focus polling'
  }
}
