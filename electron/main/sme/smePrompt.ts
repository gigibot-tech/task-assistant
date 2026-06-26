export interface SmeTaskContext {
  title: string
  description?: string
  work_phase?: string
  active_subtask_title?: string
}

export function buildSmeValidationPrompt(
  task: SmeTaskContext,
  domain: string,
  approach: string
): string {
  const taskBlock = [
    `Task: ${task.title}`,
    task.description ? `Description: ${task.description}` : null,
    task.work_phase ? `Work phase: ${task.work_phase}` : null,
    task.active_subtask_title ? `Active subtask: ${task.active_subtask_title}` : null
  ]
    .filter(Boolean)
    .join('\n')

  return `You are a senior subject matter expert in "${domain}".

Evaluate the user's proposed approach for the task below. Be direct and practical.
This is planning validation — not a coding exercise. Do not push a "smallest vertical slice" or 30-minute rule.

${taskBlock}

User approach:
"${approach}"

Respond with JSON only:
{
  "alignment": 0.0-1.0,
  "agreement": "agree" | "disagree" | "partial",
  "feedback": "concise expert feedback",
  "reasoning": "why you agree or disagree",
  "recommended_steps": [
    {
      "title": "short corrective action",
      "rationale": "why this step matters",
      "priority": "high" | "medium" | "low"
    }
  ]
}

Rules:
- recommended_steps: 0-5 expert corrective actions (not probe-style coding slices)
- alignment reflects how sound the approach is for this task and domain`
}
