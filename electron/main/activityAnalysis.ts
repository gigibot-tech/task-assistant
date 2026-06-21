import axios from 'axios'
import { nativeImage } from 'electron'
import {
  captureScreen,
  captureScreenBase64,
  requestScreenPermission,
  getScreenPermissionStatus,
  ScreenPermissionError
} from './screenCapture'
import {
  formatSubtaskFocusBlock,
  type SubtaskFocusContext
} from './subtaskProbe/subtaskFocusContext'
import { getFeatureFlagsFromSettings, type FeatureFlags } from './features/registry'
import {
  getRegisteredModules,
  runPromptPipeline,
  runResultPipeline
} from './features/kernel/register'
import type { FeatureContext } from '../../src/shared/kernel/types'

const OLLAMA_CHAT_URL = 'http://localhost:11434/api/chat'

export interface TaskFocusContext {
  title: string
  description?: string
}

export interface ActivityAnalysis {
  activity: string
  label: string
  imagePath?: string
}

export type WorkMode = 'probe' | 'on_subtask' | 'over_design' | 'off_task'

export interface DeviationResult {
  similarity: number
  severity: 'low' | 'medium' | 'high'
  suggestion: string
  currentActivity: string
  activityLabel?: string
  imagePath?: string
  onTask: boolean
  expectedTask: string
  matched_subtask_id?: string | null
  on_active_subtask?: boolean
  work_mode?: WorkMode
  codebase_phase_match?: boolean
  phase_mismatch?: boolean
}

function severityFromSimilarity(similarity: number): 'low' | 'medium' | 'high' {
  if (similarity > 0.6) return 'low'
  if (similarity > 0.4) return 'medium'
  return 'high'
}

export function formatPlannedTask(task: TaskFocusContext): string {
  const lines = [`Title: ${task.title.trim()}`]
  if (task.description?.trim()) {
    lines.push(`Description: ${task.description.trim()}`)
  }
  return lines.join('\n')
}

const VISION_MAX_WIDTH = 1280

function prepareVisionBase64(pngBuffer: Buffer): string {
  const image = nativeImage.createFromBuffer(pngBuffer)
  const { width, height } = image.getSize()

  if (width <= VISION_MAX_WIDTH) {
    return pngBuffer.toString('base64')
  }

  const scale = VISION_MAX_WIDTH / width
  const resized = image.resize({
    width: VISION_MAX_WIDTH,
    height: Math.max(1, Math.round(height * scale)),
    quality: 'good'
  })

  return resized.toPNG().toString('base64')
}

function stripModelNoise(raw: string): string {
  let text = raw.trim()
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  text = text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
  return text.trim()
}

function extractFieldsFromBrokenJson(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  const stringField = (key: string) => {
    const match = raw.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'i'))
    return match?.[1]?.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\')
  }

  const numberField = (key: string) => {
    const match = raw.match(new RegExp(`"${key}"\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)`, 'i'))
    return match ? parseFloat(match[1]) : undefined
  }

  const boolField = (key: string) => {
    const match = raw.match(new RegExp(`"${key}"\\s*:\\s*(true|false)`, 'i'))
    return match ? match[1].toLowerCase() === 'true' : undefined
  }

  out.activity = stringField('activity')
  out.label = stringField('label')
  out.explanation = stringField('explanation') ?? stringField('suggestion')
  out.similarity = numberField('similarity')
  out.onTask = boolField('onTask')

  return out
}

function parseJsonResponse<T extends Record<string, unknown>>(raw: string): T {
  if (!raw?.trim()) {
    console.warn('[ollama] Empty response body')
    return {} as T
  }

  const cleaned = stripModelNoise(raw)
  const attempts: Array<() => unknown> = [
    () => JSON.parse(cleaned),
    () => {
      const once = JSON.parse(cleaned)
      if (typeof once === 'string') return JSON.parse(once)
      return once
    },
    () => {
      const match = cleaned.match(/\{[\s\S]*\}/)
      if (!match) throw new Error('No JSON object found')
      return JSON.parse(match[0])
    }
  ]

  for (const attempt of attempts) {
    try {
      const parsed = attempt()
      if (parsed && typeof parsed === 'object') {
        return parsed as T
      }
    } catch {
      /* try next strategy */
    }
  }

  const extracted = extractFieldsFromBrokenJson(cleaned)
  if (Object.values(extracted).some((value) => value !== undefined)) {
    console.warn('[ollama] Used regex field extraction fallback')
    return extracted as T
  }

  console.warn('[ollama] Unparseable response (first 600 chars):', cleaned.slice(0, 600))
  return {} as T
}

function clampSimilarity(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value))
  if (Number.isNaN(n)) return 0.5
  return Math.min(1, Math.max(0, n))
}

async function ollamaGenerate(
  model: string,
  prompt: string,
  images?: string[]
): Promise<string> {
  const message: Record<string, unknown> = { role: 'user', content: prompt }
  if (images?.length) {
    message.images = images
  }

  const body: Record<string, unknown> = {
    model,
    messages: [message],
    stream: false,
    format: 'json',
    options: { temperature: 0.2, num_predict: 512 }
  }

  let lastError: Error | null = null

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await axios.post(OLLAMA_CHAT_URL, body, { timeout: 120000 })
      const text = response.data?.message?.content ?? response.data?.response

      if (response.data?.error) {
        throw new Error(String(response.data.error))
      }
      if (typeof text !== 'string' || !text.trim()) {
        throw new Error('Empty Ollama response')
      }

      return text
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt === 0) {
        console.warn('[ollama] Request failed, retrying once:', lastError.message)
        await new Promise((resolve) => setTimeout(resolve, 1500))
      }
    }
  }

  throw lastError ?? new Error('Ollama request failed')
}

const FOCUS_SCORING_RULES = `Scoring rules (similarity 0.0-1.0):
- 0.0-0.25: unrelated activity (social media, games, entertainment, unrelated apps)
- 0.2-0.45: planning/organizing only — task managers, to-do apps, calendars, or Task Assistant while merely viewing or editing this task (NOT doing the real work)
- 0.5-0.7: partially related (related research or prep, but not core task work)
- 0.75-1.0: clearly doing the actual task (writing, coding, reading task materials, analysis, etc.)`

export async function compareTaskToActivity(
  model: string,
  task: TaskFocusContext,
  currentActivity: string
): Promise<{ similarity: number; explanation: string; onTask: boolean }> {
  const plannedTask = formatPlannedTask(task)
  const prompt = `You are a strict focus coach. Compare the user's PLANNED task with what they are ACTUALLY doing.

Planned task:
${plannedTask}

Current activity on screen:
${currentActivity}

${FOCUS_SCORING_RULES}

Set onTask to true only when they are doing substantive work that advances the planned task (similarity >= 0.7).

Respond with JSON: {"similarity": 0.0-1.0, "onTask": true/false, "explanation": "brief coaching note"}`

  const raw = await ollamaGenerate(model, prompt)
  const parsed = parseJsonResponse<{
    similarity?: number
    onTask?: boolean
    explanation?: string
  }>(raw)
  const similarity = clampSimilarity(parsed.similarity)

  return {
    similarity,
    onTask: typeof parsed.onTask === 'boolean' ? parsed.onTask : similarity >= 0.7,
    explanation: parsed.explanation || ''
  }
}

/** Single vision call: describe screen and judge focus against title + description + subtasks. */
export async function checkDeviationFromScreen(
  model: string,
  task: SubtaskFocusContext,
  saveCapture = true,
  options?: {
    recentScreenSimilarity?: number
    recentScreenSampleCount?: number
    featureFlags?: FeatureFlags
  }
): Promise<DeviationResult> {
  const status = getScreenPermissionStatus()
  if (status === 'not-determined') {
    await requestScreenPermission()
  }

  let imagePath: string | undefined
  let base64: string

  if (saveCapture) {
    const capture = await captureScreen()
    imagePath = capture.imagePath
    const pngBuffer = (await import('fs')).readFileSync(capture.imagePath)
    base64 = prepareVisionBase64(pngBuffer)
  } else {
    const pngBuffer = Buffer.from(await captureScreenBase64(), 'base64')
    base64 = prepareVisionBase64(pngBuffer)
  }

  const plannedTask = formatPlannedTask(task)
  const subtaskBlock = formatSubtaskFocusBlock(task)
  const hasSubtasks = (task.subtasks?.length ?? 0) > 0 || task.activeSubtask

  const unchangedHint =
    options?.recentScreenSimilarity != null &&
    options.recentScreenSampleCount != null &&
    options.recentScreenSampleCount >= 2 &&
    options.recentScreenSimilarity >= 0.88
      ? `\nRecent captures for this task looked ${Math.round(options.recentScreenSimilarity * 100)}% visually similar. If this screenshot is also unchanged (same layout, scroll position, no new edits), say so in activity and score similarity lower unless you see clear new progress.\n`
      : ''

  const flags = options?.featureFlags ?? getFeatureFlagsFromSettings()
  const focusTask = {
    work_phase: task.work_phase,
    subtasks: task.subtasks,
    active_subtask_id: task.activeSubtask?.id ?? null
  }
  const pipelineCtx: FeatureContext = {
    task: focusTask as Record<string, unknown>,
    flags
  }
  const phaseBlock = runPromptPipeline(getRegisteredModules(), 'focus.prompt', pipelineCtx)

  const subtaskRules = hasSubtasks
    ? `
${subtaskBlock}

Also classify subtask focus:
- matched_subtask_id: id of best-matching subtask or null
- on_active_subtask: true if screen work clearly advances the active subtask's I/O/T outcome
- work_mode: one of "probe" | "on_subtask" | "over_design" | "off_task"
  - probe: ugly script / spike coding on active subtask (counts as on-task)
  - on_subtask: substantive work on active subtask
  - over_design: diagrams, class maps, architecture docs without runnable code
  - off_task: unrelated or passive browsing

Set onTask true when on_active_subtask OR work_mode is "probe".
over_design is NOT on-task even if task-related.
`
    : ''

  const prompt = `You are a strict focus coach. The user planned to work on:
${plannedTask}
${subtaskRules}
${phaseBlock}
Look at the screenshot. Judge whether they are doing substantive work that advances THIS specific task right now.
${unchangedHint}
${FOCUS_SCORING_RULES}

Set onTask to true only when they are clearly doing the actual task work (similarity >= 0.7).
Viewing or organizing this task in a task manager / planner / Task Assistant does NOT count as on-task.

Respond with JSON only:
{"activity":"detailed on-screen activity","label":"short label e.g. writing, task-manager","similarity":0.0,"onTask":false,"explanation":"one sentence coaching note"${hasSubtasks ? ',"matched_subtask_id":null,"on_active_subtask":false,"work_mode":"off_task"' : ''}${phaseBlock ? ',"codebase_phase_match":true' : ''}}`

  const raw = await ollamaGenerate(model, prompt, [base64])
  const parsed = parseJsonResponse<{
    activity?: string
    label?: string
    similarity?: number
    onTask?: boolean
    explanation?: string
    matched_subtask_id?: string | null
    on_active_subtask?: boolean
    work_mode?: WorkMode
    codebase_phase_match?: boolean
  }>(raw)

  const parsedEmpty =
    !parsed.activity &&
    parsed.similarity == null &&
    !parsed.explanation &&
    !parsed.label

  const similarity = clampSimilarity(parsed.similarity ?? (parsedEmpty ? 0.5 : undefined))

  let workMode = parsed.work_mode
  let onActiveSubtask = parsed.on_active_subtask === true
  let matchedSubtaskId = parsed.matched_subtask_id ?? null

  let onTask: boolean
  if (hasSubtasks && !parsedEmpty) {
    if (workMode === 'probe' || onActiveSubtask) {
      onTask = true
    } else if (workMode === 'over_design' || workMode === 'off_task') {
      onTask = false
    } else if (workMode === 'on_subtask') {
      onTask = onActiveSubtask || similarity >= 0.7
    } else {
      onTask = typeof parsed.onTask === 'boolean' ? parsed.onTask : similarity >= 0.7
    }
  } else {
    onTask = typeof parsed.onTask === 'boolean' ? parsed.onTask : similarity >= 0.7
    workMode = onTask ? 'on_subtask' : 'off_task'
  }

  const baseResult: DeviationResult = {
    similarity,
    severity: severityFromSimilarity(similarity),
    suggestion:
      parsed.explanation ||
      (parsedEmpty ? 'AI response was unclear — try Check Deviation again.' : ''),
    currentActivity: parsed.activity || raw.slice(0, 280) || 'Unknown activity',
    activityLabel: parsed.label || 'unknown',
    imagePath,
    onTask: parsedEmpty ? false : onTask,
    expectedTask: plannedTask,
    matched_subtask_id: matchedSubtaskId,
    on_active_subtask: onActiveSubtask,
    work_mode: workMode
  }

  return runResultPipeline(
    getRegisteredModules(),
    'focus.result',
    {
      ...pipelineCtx,
      parsed: {
        codebase_phase_match: parsed.codebase_phase_match,
        work_mode: workMode
      },
      focusResult: baseResult
    },
    baseResult
  )
}

export async function analyzeScreenshotActivity(
  model: string,
  saveCapture = true
): Promise<ActivityAnalysis> {
  let imagePath: string | undefined
  let base64: string

  if (saveCapture) {
    const capture = await captureScreen()
    imagePath = capture.imagePath
    const pngBuffer = (await import('fs')).readFileSync(capture.imagePath)
    base64 = prepareVisionBase64(pngBuffer)
  } else {
    const pngBuffer = Buffer.from(await captureScreenBase64(), 'base64')
    base64 = prepareVisionBase64(pngBuffer)
  }

  const prompt = `Look at this screenshot. Describe what the user is actively doing — name specific apps and content visible.
Respond with JSON only: {"activity": "detailed description", "label": "short label e.g. coding, task-manager, browsing"}`

  const raw = await ollamaGenerate(model, prompt, [base64])
  const parsed = parseJsonResponse<{ activity?: string; label?: string }>(raw)

  return {
    activity: parsed.activity || 'Unknown activity',
    label: parsed.label || 'unknown',
    imagePath
  }
}

export { ScreenPermissionError, requestScreenPermission, getScreenPermissionStatus }
