export type SmeAgreement = 'agree' | 'disagree' | 'partial'

export type SmeValidationTrigger = 'manual' | 'scheduled' | 'pre_subtask'

export type SmeWindowDays = 7 | 14 | 30 | 90

export interface SmeRecommendedStep {
  title: string
  rationale: string
  priority?: 'high' | 'medium' | 'low'
}

export interface SmeValidationEntry {
  id: string
  recorded_at: string
  domain: string
  approach: string
  alignment: number
  agreement: SmeAgreement
  feedback: string
  reasoning: string
  recommended_steps?: SmeRecommendedStep[]
  promoted_subtask_ids?: string[]
  trigger?: SmeValidationTrigger
}

export interface SmeValidationResult {
  alignment: number
  agreement: SmeAgreement
  feedback: string
  reasoning: string
  recommended_steps?: SmeRecommendedStep[]
}
