export type DriveAspect = 'curiosity' | 'ownership' | 'external_pressure' | 'freedom'

export type ThinkingBand = 'under_10m' | '30m' | '1_2h' | 'more'

export type SubtaskStatus = 'pending' | 'active' | 'done' | 'blocked'

export type SubtaskSource = 'user' | 'ai_probe' | 'prime_day' | 'stuck'

export type StuckTrigger = 'deviation' | 'stale' | 'manual' | 'prime_day'

export type WorkMode = 'probe' | 'on_subtask' | 'over_design' | 'off_task'

export type SoftwarePhase = 'playground' | 'core' | 'extract'

export type PhaseSource = 'user' | 'git' | 'probe'

export interface ExtractionChecks {
  useful: boolean
  explainable: boolean
  e2e: boolean
}

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

export interface TaskSubtask {
  id: string
  title: string
  input: string
  output: string
  transformation: string
  outcome: string
  status: SubtaskStatus
  created_at: string
  validated_at?: string
  validated_with_real_input?: boolean
  source: SubtaskSource
  phase?: SoftwarePhase
  extraction_of_subtask_id?: string
  extraction_checks?: ExtractionChecks
}

export interface StuckEvent {
  id: string
  recorded_at: string
  trigger: StuckTrigger
  thinking_band: ThinkingBand
  wasted_seconds_estimated: number
  subtask_id?: string
  ai_challenge?: string
  ai_suggested_subtask?: string
}

export interface ProbeResult {
  challenge: string
  input: string
  output: string
  transformation: string
  smallest_slice: string
  suggested_subtask: {
    title: string
    input: string
    output: string
    transformation: string
    outcome: string
  }
  stupid_version_hint: string
  must_code_by: string
  build_one_now: string
  max_components: number
  recommended_phase?: SoftwarePhase
  extraction_ready?: boolean
  materialization_checks?: { useful: string; explainable: string; e2e: string }
}

export interface WastedStats {
  by_day: Record<string, number>
  by_week: Record<string, number>
  by_thinking_band: Record<string, number>
  off_task_episode_count: number
}

export const THINKING_BAND_LABELS: Record<ThinkingBand, string> = {
  under_10m: '<10 min',
  '30m': '~30 min',
  '1_2h': '1–2 h',
  more: 'More'
}

export const DEFAULT_BAND_MINUTES: Record<ThinkingBand, number> = {
  under_10m: 5,
  '30m': 25,
  '1_2h': 90,
  more: 150
}

export function buildOutcome(input: string, output: string, transformation: string): string {
  const i = input.trim()
  const o = output.trim()
  const t = transformation.trim()
  if (!i || !o || !t) return ''
  return `I can get ${o} from ${i} via ${t}`
}

export function isSubtaskReady(subtask: Pick<TaskSubtask, 'input' | 'output' | 'transformation'>): boolean {
  return !!(subtask.input?.trim() && subtask.output?.trim() && subtask.transformation?.trim())
}

export function formatSubtaskIot(subtask: TaskSubtask): string {
  return `${subtask.input} → ${subtask.output} (${subtask.transformation})`
}
