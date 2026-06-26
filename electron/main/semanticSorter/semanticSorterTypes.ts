export interface SorterDecision {
  source: string
  category: string
  confidence: number
  destination: string
  reason: string
  human_category: string
  human_reason: string
  semantic_tags: string[]
  matched_rules: string[]
  script_category?: string
  script_confidence?: number
  script_reason?: string
  augmented_by_ollama?: boolean
  destination_relative?: string
}

export interface SemanticSorterDryRunResult {
  decisions: SorterDecision[]
  summary: string
  csvPath: string | null
}

export interface SemanticSorterApplyResult {
  moved: number
  errors: Array<{ source: string; error: string }>
}

export interface SemanticSorterFeedbackRecord {
  created_at: string
  source: string
  source_name: string
  category: string
  destination: string
  tags: string[]
  note: string
}
