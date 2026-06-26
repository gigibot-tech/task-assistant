import { randomUUID } from 'crypto'
import { ollamaGenerate, parseJsonResponse } from '../ollamaClient'
import { getOllamaNumPredict } from '../ollamaSettings'
import { buildSmeValidationPrompt, type SmeTaskContext } from './smePrompt'

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
  agreement: 'agree' | 'disagree' | 'partial'
  feedback: string
  reasoning: string
  recommended_steps?: SmeRecommendedStep[]
  promoted_subtask_ids?: string[]
  trigger?: 'manual' | 'scheduled' | 'pre_subtask'
}

function normalizeAlignment(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value))
  if (!Number.isFinite(n)) return 0.5
  return Math.min(1, Math.max(0, n))
}

function normalizeAgreement(
  value: unknown,
  alignment: number
): 'agree' | 'disagree' | 'partial' {
  if (value === 'agree' || value === 'disagree' || value === 'partial') return value
  if (alignment >= 0.7) return 'agree'
  if (alignment >= 0.4) return 'partial'
  return 'disagree'
}

function normalizeSteps(raw: unknown): SmeRecommendedStep[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      const title = String(row.title ?? '').trim()
      const rationale = String(row.rationale ?? row.reason ?? '').trim()
      if (!title) return null
      const priority = row.priority
      const p =
        priority === 'high' || priority === 'medium' || priority === 'low'
          ? priority
          : undefined
      return { title, rationale: rationale || title, priority: p }
    })
    .filter((s): s is SmeRecommendedStep => s !== null)
    .slice(0, 5)
}

function fallbackEntry(
  domain: string,
  approach: string,
  message: string
): SmeValidationEntry {
  return {
    id: randomUUID(),
    recorded_at: new Date().toISOString(),
    domain,
    approach,
    alignment: 0.5,
    agreement: 'partial',
    feedback: message,
    reasoning: message,
    recommended_steps: [],
    promoted_subtask_ids: [],
    trigger: 'manual'
  }
}

export async function runSmeValidation(
  model: string,
  task: SmeTaskContext,
  domain: string,
  approach: string,
  settings?: Record<string, unknown>
): Promise<SmeValidationEntry> {
  const trimmedDomain = domain.trim()
  const trimmedApproach = approach.trim()
  if (!trimmedDomain || !trimmedApproach) {
    return fallbackEntry(trimmedDomain || 'General', trimmedApproach, 'Domain and approach are required.')
  }

  const prompt = buildSmeValidationPrompt(task, trimmedDomain, trimmedApproach)

  try {
    const raw = await ollamaGenerate(model, prompt, undefined, {
      numPredict: getOllamaNumPredict(settings, 'text'),
      showErrorDialog: false
    })
    const parsed = parseJsonResponse(raw) as Record<string, unknown>
    const alignment = normalizeAlignment(parsed.alignment)
    const agreement = normalizeAgreement(parsed.agreement, alignment)

    return {
      id: randomUUID(),
      recorded_at: new Date().toISOString(),
      domain: trimmedDomain,
      approach: trimmedApproach,
      alignment,
      agreement,
      feedback: String(parsed.feedback ?? '').trim() || 'No feedback returned.',
      reasoning: String(parsed.reasoning ?? parsed.feedback ?? '').trim() || 'No reasoning returned.',
      recommended_steps: normalizeSteps(parsed.recommended_steps),
      promoted_subtask_ids: [],
      trigger: 'manual'
    }
  } catch (err) {
    console.error('[sme] Validation failed:', err)
    return fallbackEntry(
      trimmedDomain,
      trimmedApproach,
      'Unable to validate — Ollama may not be running or returned invalid JSON.'
    )
  }
}

export function smeTaskContextFromRecord(task: Record<string, unknown>): SmeTaskContext {
  const subtasks = (task.subtasks ?? []) as Array<{ id: string; title?: string }>
  const activeId = task.active_subtask_id as string | null | undefined
  const active = subtasks.find((s) => s.id === activeId)

  return {
    title: String(task.title ?? 'Untitled task'),
    description: task.description ? String(task.description) : undefined,
    work_phase: task.work_phase ? String(task.work_phase) : undefined,
    active_subtask_title: active?.title
  }
}
