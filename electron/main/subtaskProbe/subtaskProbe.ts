import { ollamaGenerate, parseJsonResponse } from '../ollamaClient'
import { formatProbeTaskBlock } from './subtaskFocusContext'
import type { SubtaskRecord } from './subtaskFocusContext'
import { getFeatureFlagsFromSettings, type FeatureFlags } from '../features/registry'
import {
  getRegisteredModules,
  runPromptPipeline,
  runResultPipeline
} from '../features/kernel/register'
import type { FeatureContext } from '../../../src/shared/kernel/types'

export interface ProbeRunInput {
  task: {
    title: string
    description?: string
    subtasks?: SubtaskRecord[]
    active_subtask_id?: string | null
    work_phase?: string
  }
  userLine?: string
  thinkingBand?: string
  trigger?: string
  featureFlags?: FeatureFlags
}

export interface ProbeRunResult {
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
  recommended_phase?: string
  extraction_ready?: boolean
  materialization_checks?: { useful: string; explainable: string; e2e: string }
}

function mustCodeByIso(): string {
  return new Date(Date.now() + 30 * 60 * 1000).toISOString()
}

function fallbackProbe(taskTitle: string): ProbeRunResult {
  const must = mustCodeByIso()
  return {
    challenge: `Stop architecting "${taskTitle}" — prove one vertical slice in code within 30 minutes.`,
    input: 'one real sample',
    output: 'one concrete result',
    transformation: 'minimal script',
    smallest_slice: 'End-to-end path with hardcoded values',
    suggested_subtask: {
      title: 'Smallest probe',
      input: 'one real sample',
      output: 'one concrete result',
      transformation: 'minimal script',
      outcome: 'I can get one concrete result from one real sample via minimal script'
    },
    stupid_version_hint: 'Write an ugly single-file script — no classes, no layers.',
    must_code_by: must,
    build_one_now: 'Open editor and write the stupid version now.',
    max_components: 3
  }
}

export async function runSubtaskProbe(
  model: string,
  input: ProbeRunInput,
  settingsFlags?: Partial<FeatureFlags>
): Promise<ProbeRunResult> {
  const flags = input.featureFlags ?? getFeatureFlagsFromSettings({ featureFlags: settingsFlags })
  const taskBlock = formatProbeTaskBlock(input.task)
  const pipelineCtx: FeatureContext = {
    task: input.task as Record<string, unknown>,
    flags,
    probeInput: { userLine: input.userLine, thinkingBand: input.thinkingBand },
    trigger: input.trigger
  }
  const phaseBlock = runPromptPipeline(getRegisteredModules(), 'probe.prompt', pipelineCtx)
  const userLine = input.userLine?.trim() || '(none)'
  const band = input.thinkingBand || 'n/a'
  const trigger = input.trigger || 'manual'

  const prompt = `You are a focus coach using the Andrea Method for software work.

Core rule: You clarify by acting, not by thinking longer.
Thinking is only allowed if it leads to code within 30 minutes.

Method: Step0 define input/output/transformation → 30min cap → stupid script →
test real data → reflect → then structure. Vertical slice only. Max 3 components.

${taskBlock}
${phaseBlock}

Trigger: ${trigger}
User says: "${userLine}"
Thinking band before coding: ${band}

If thinking band is 30m, 1_2h, or more, challenge architecture and over-design urges directly.

Respond with JSON only:
{
  "challenge": "one sentence battling current belief",
  "input": "concrete input",
  "output": "concrete output",
  "transformation": "how to transform",
  "smallest_slice": "vertical slice to prove next",
  "suggested_subtask": {
    "title": "short name",
    "input": "...",
    "output": "...",
    "transformation": "...",
    "outcome": "I can get X from Y via Z"
  },
  "stupid_version_hint": "ugly script, no classes",
  "must_code_by": "ISO timestamp 30min from now",
  "build_one_now": "concrete next action within 30 min",
  "max_components": 3${phaseBlock ? ',\n  "recommended_phase": "playground",\n  "extraction_ready": false,\n  "materialization_checks": { "useful": "...", "explainable": "...", "e2e": "..." }' : ''}
}`

  try {
    const raw = await ollamaGenerate(model, prompt, undefined, { numPredict: 768 })
    const parsed = parseJsonResponse<Record<string, unknown>>(raw)
    const suggested = (parsed.suggested_subtask as Record<string, string>) || {}

    const result: ProbeRunResult = {
      challenge: String(parsed.challenge || fallbackProbe(input.task.title).challenge),
      input: String(parsed.input || suggested.input || ''),
      output: String(parsed.output || suggested.output || ''),
      transformation: String(parsed.transformation || suggested.transformation || ''),
      smallest_slice: String(parsed.smallest_slice || ''),
      suggested_subtask: {
        title: String(suggested.title || 'Smallest probe'),
        input: String(suggested.input || parsed.input || 'one real sample'),
        output: String(suggested.output || parsed.output || 'one result'),
        transformation: String(suggested.transformation || parsed.transformation || 'script'),
        outcome: String(
          suggested.outcome ||
            `I can get ${suggested.output || 'result'} from ${suggested.input || 'sample'} via ${suggested.transformation || 'script'}`
        )
      },
      stupid_version_hint: String(
        parsed.stupid_version_hint || 'Write an ugly single-file script first.'
      ),
      must_code_by: String(parsed.must_code_by || mustCodeByIso()),
      build_one_now: String(parsed.build_one_now || 'Start coding the stupid version now.'),
      max_components: typeof parsed.max_components === 'number' ? parsed.max_components : 3
    }

    return runResultPipeline(getRegisteredModules(), 'probe.result', {
      ...pipelineCtx,
      parsed
    }, result)
  } catch (err) {
    console.error('[subtaskProbe] failed:', err)
    return fallbackProbe(input.task.title)
  }
}
