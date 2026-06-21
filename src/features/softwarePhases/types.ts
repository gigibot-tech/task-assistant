export type SoftwarePhase = 'playground' | 'core' | 'extract'

export type PhaseSource = 'user' | 'git' | 'probe'

export interface PhaseBalance {
  playground_minutes_7d: number
  core_minutes_7d: number
  extract_events_7d: number
  last_git_sync_at?: string
  last_inferred_phase?: SoftwarePhase
  git_available?: boolean
  git_suggested_phase?: SoftwarePhase
  git_confidence?: number
  recent_commits_summary?: string[]
  imbalance_score?: number
}

export interface ExtractionChecks {
  useful: boolean
  explainable: boolean
  e2e: boolean
}

export const PHASE_LABELS: Record<SoftwarePhase, string> = {
  playground: 'Playground',
  core: 'Core',
  extract: 'Extract'
}

export const PHASE_TAGLINE = 'Build messy. Keep clean. Never mix.'

export function defaultPhaseBalance(): PhaseBalance {
  return {
    playground_minutes_7d: 0,
    core_minutes_7d: 0,
    extract_events_7d: 0
  }
}
