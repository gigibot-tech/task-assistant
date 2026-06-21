import type { ProbeRunResult } from '../../subtaskProbe/subtaskProbe'
import type { SoftwarePhase } from '../../../../src/features/softwarePhases/types'

const PHASE_PROBE_BLOCKS: Record<SoftwarePhase, string> = {
  playground: `
Software phase: PLAYGROUND (chaos allowed).
- Ask: what are you testing? What is the output?
- Encourage messy vertical slice — vibe coding OK.
- recommended_phase should usually be "playground".`,
  core: `
Software phase: CORE (clean only).
- Only reusable, working logic. No new abstractions.
- Push minimal composable slices. recommended_phase should be "core".`,
  extract: `
Software phase: EXTRACT (move signal playground → core).
- What worked in playground? Apply 3 materialization checks.
- extraction_ready true when user should promote a slice to core.
- recommended_phase should be "extract" or "core".`
}

export function buildPhaseProbeExtension(workPhase?: string): string {
  const phase = (workPhase as SoftwarePhase) || 'playground'
  const block = PHASE_PROBE_BLOCKS[phase] ?? PHASE_PROBE_BLOCKS.playground
  return `
${block}

Also include in JSON when software phases are active:
"recommended_phase": "playground|core|extract",
"extraction_ready": false,
"materialization_checks": { "useful": "...", "explainable": "...", "e2e": "..." }
`
}

export function adjustProbeForPhase(
  result: ProbeRunResult,
  workPhase: string | undefined,
  parsed: Record<string, unknown>
): ProbeRunResult & {
  recommended_phase?: string
  extraction_ready?: boolean
  materialization_checks?: { useful: string; explainable: string; e2e: string }
} {
  const checks = parsed.materialization_checks as Record<string, string> | undefined
  return {
    ...result,
    recommended_phase: String(parsed.recommended_phase || workPhase || 'playground'),
    extraction_ready: parsed.extraction_ready === true,
    materialization_checks: {
      useful: checks?.useful || 'Will I use this again?',
      explainable: checks?.explainable || 'Can I explain it in one sentence?',
      e2e: checks?.e2e || 'Does it work end-to-end?'
    }
  }
}
