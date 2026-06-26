import { formatPlannedTask, type TaskFocusContext } from '../activityAnalysis'

export interface SubtaskRecord {
  id: string
  title: string
  input?: string
  output?: string
  transformation?: string
  outcome?: string
  status?: string
  phase?: string
}

export interface SubtaskFocusContext extends TaskFocusContext {
  activeSubtask?: SubtaskRecord | null
  subtasks?: SubtaskRecord[]
  work_phase?: string
}

export function formatSubtaskForPrompt(st: SubtaskRecord, index: number): string {
  const iot =
    st.input && st.output && st.transformation
      ? ` | in: ${st.input} → out: ${st.output} (${st.transformation})`
      : ''
  return `${index + 1}. [${st.id}] ${st.title}${iot} — ${st.outcome || 'no outcome yet'} (${st.status || 'pending'})`
}

export function formatSubtaskFocusBlock(ctx: SubtaskFocusContext, maxSubtasks = 4): string {
  const lines: string[] = []
  const active = ctx.activeSubtask
  if (active) {
    lines.push(
      `Active subtask: [${active.id}] ${active.title}`,
      `  Input: ${active.input || '?'}`,
      `  Output: ${active.output || '?'}`,
      `  Transformation: ${active.transformation || '?'}`,
      `  Outcome: ${active.outcome || '?'}`
    )
  } else {
    lines.push('Active subtask: none')
  }

  const list = ctx.subtasks ?? []
  if (list.length > 0) {
    const activeId = active?.id
    const others = list.filter((st) => st.id !== activeId)
    const capped = others.slice(0, Math.max(0, maxSubtasks - (active ? 1 : 0)))
    lines.push('Subtasks (most relevant only — not full history):')
    if (active) lines.push(formatSubtaskForPrompt(active, 0))
    capped.forEach((st, i) => lines.push(formatSubtaskForPrompt(st, i + (active ? 1 : 0))))
    if (others.length > capped.length) {
      lines.push(`… ${others.length - capped.length} more subtask(s) omitted from prompt`)
    }
  }

  return lines.join('\n')
}

export function taskSubtaskContextFromTask(task: {
  title: string
  description?: string
  subtasks?: SubtaskRecord[]
  active_subtask_id?: string | null
  work_phase?: string
}): SubtaskFocusContext {
  const subtasks = task.subtasks ?? []
  const activeSubtask =
    subtasks.find((s) => s.id === task.active_subtask_id) ?? null

  return {
    title: task.title,
    description: task.description,
    subtasks,
    activeSubtask,
    work_phase: task.work_phase
  }
}

export function formatProbeTaskBlock(task: {
  title: string
  description?: string
  subtasks?: SubtaskRecord[]
  active_subtask_id?: string | null
}): string {
  const base = formatPlannedTask({ title: task.title, description: task.description })
  const sub = formatSubtaskFocusBlock(taskSubtaskContextFromTask(task))
  return `${base}\n\n${sub}`
}
