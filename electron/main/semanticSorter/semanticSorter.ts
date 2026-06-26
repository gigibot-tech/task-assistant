import { spawn } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { augmentDecisionWithOllama } from './semanticSorterOllama'
import {
  getFeedbackPath,
  getKnowledgePath,
  getLastRunCsvPath,
  getSortScriptPath,
  loadKnowledgeDestinations,
  mergeSemanticSorterSettings,
  resolveFolder,
  type SemanticSorterSettings
} from './semanticSorterPaths'
import type {
  SemanticSorterApplyResult,
  SemanticSorterDryRunResult,
  SemanticSorterFeedbackRecord,
  SorterDecision
} from './semanticSorterTypes'

function uniqueDestination(target: string): string {
  if (!fs.existsSync(target)) return target
  const dir = path.dirname(target)
  const ext = path.extname(target)
  const stem = path.basename(target, ext)
  const digest = crypto.createHash('sha1').update(target).digest('hex').slice(0, 7)
  return path.join(dir, `${stem} (${digest})${ext}`)
}

function resolveAbsoluteDestination(
  relativeOrAbs: string,
  settings: SemanticSorterSettings & ReturnType<typeof mergeSemanticSorterSettings>,
  sourceName: string
): string {
  const rel = relativeOrAbs.replace(/^\/+/, '')
  const parts = rel.split('/').filter(Boolean)
  const destRoot = resolveFolder(settings.destRoot) ?? resolveFolder(settings.personalRoot)
  if (!destRoot) {
    throw new Error('Destination root is not configured or does not exist')
  }

  if (parts[0] === 'HS-Hannover') {
    const hsRoot = resolveFolder(settings.hsRoot)
    const tail = parts.slice(1)
    if (hsRoot) {
      return path.join(hsRoot, ...tail, sourceName)
    }
    return path.join(destRoot, '_Needs HS-Hannover Mount', ...tail, sourceName)
  }

  if (parts[0] === 'Personal') {
    const personal = resolveFolder(settings.personalRoot) ?? destRoot
    return path.join(personal, ...parts.slice(1), sourceName)
  }

  if (path.isAbsolute(relativeOrAbs)) {
    return path.join(relativeOrAbs, sourceName)
  }

  return path.join(destRoot, rel, sourceName)
}

function runPythonDecisions(
  settings: SemanticSorterSettings & ReturnType<typeof mergeSemanticSorterSettings>,
  sourcePath: string
): Promise<SorterDecision[]> {
  const script = getSortScriptPath()
  if (!fs.existsSync(script)) {
    return Promise.reject(new Error(`sort_files.py not found at ${script}`))
  }

  const destRoot = resolveFolder(settings.destRoot) ?? resolveFolder(settings.personalRoot)
  if (!destRoot) {
    return Promise.reject(new Error('Configure a destination root in settings'))
  }

  const knowledge = getKnowledgePath(settings)
  const feedback = getFeedbackPath()
  const args = [
    script,
    '--source',
    sourcePath,
    '--dest-root',
    destRoot,
    '--knowledge',
    knowledge,
    '--feedback',
    feedback,
    '--min-confidence',
    String(settings.minConfidence),
    '--emit-json',
    '--decisions-only'
  ]

  if (settings.inspectContents) args.push('--inspect-contents')
  if (settings.recursive) args.push('--recursive')

  const personal = resolveFolder(settings.personalRoot)
  if (personal) {
    args.push('--personal-root', personal)
  }

  const hs = resolveFolder(settings.hsRoot)
  if (hs) {
    args.push('--hs-root', hs)
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(settings.pythonPath, args, { cwd: path.dirname(script) })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8')
    })
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8')
    })
    proc.on('error', (err) => reject(err))
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Python sorter exited with code ${code}`))
        return
      }
      try {
        const parsed = JSON.parse(stdout.trim()) as SorterDecision[]
        resolve(parsed)
      } catch {
        reject(new Error(`Invalid JSON from sorter: ${stdout.slice(0, 200)}`))
      }
    })
  })
}

function annotateScriptFields(decisions: SorterDecision[]): SorterDecision[] {
  return decisions.map((d) => ({
    ...d,
    script_category: d.category,
    script_confidence: d.confidence,
    script_reason: d.reason
  }))
}

async function augmentDecisions(
  model: string,
  decisions: SorterDecision[],
  settings: SemanticSorterSettings & ReturnType<typeof mergeSemanticSorterSettings>
): Promise<SorterDecision[]> {
  if (!settings.ollamaAugmentEnabled) return decisions

  const knowledgePath = getKnowledgePath(settings)
  const destinations = loadKnowledgeDestinations(knowledgePath)
  const out: SorterDecision[] = []

  for (const decision of decisions) {
    const needsAugment =
      decision.category === 'review' || decision.confidence < settings.ollamaThreshold

    if (!needsAugment) {
      out.push(decision)
      continue
    }

    const ollama = await augmentDecisionWithOllama(model, decision, knowledgePath)
    if (!ollama) {
      out.push(decision)
      continue
    }

    const sourceName = path.basename(decision.source)
    const absDest = resolveAbsoluteDestination(ollama.destination, settings, sourceName)

    out.push({
      ...decision,
      category: ollama.category,
      confidence: ollama.confidence,
      reason: ollama.reason,
      destination: absDest,
      destination_relative: ollama.destination,
      semantic_tags: ollama.tags.length ? ollama.tags : decision.semantic_tags,
      augmented_by_ollama: true
    })
  }

  return out
}

function writeCsvReport(decisions: SorterDecision[], csvPath: string): void {
  const header =
    'source,script_category,script_confidence,script_reason,human_category,human_reason,semantic_tags,matched_rules,destination,augmented_by_ollama\n'
  const rows = decisions.map((d) => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
    return [
      esc(d.source),
      esc(d.script_category ?? d.category),
      esc((d.script_confidence ?? d.confidence).toFixed(2)),
      esc(d.script_reason ?? d.reason),
      esc(d.human_category),
      esc(d.human_reason),
      esc((d.semantic_tags ?? []).join(';')),
      esc((d.matched_rules ?? []).join(';')),
      esc(d.destination),
      esc(d.augmented_by_ollama ? 'yes' : 'no')
    ].join(',')
  })
  fs.writeFileSync(csvPath, header + rows.join('\n') + '\n', 'utf-8')
}

export async function runSemanticSorterDryRun(
  ollamaModel: string,
  partialSettings?: SemanticSorterSettings
): Promise<SemanticSorterDryRunResult> {
  const settings = mergeSemanticSorterSettings(partialSettings)
  const inbox =
    resolveFolder(settings.sortInboxPath) ??
    resolveFolder(settings.destRoot) ??
    resolveFolder(settings.personalRoot)

  if (!inbox) {
    throw new Error('Sort inbox path is missing or does not exist')
  }

  const base = annotateScriptFields(await runPythonDecisions(settings, inbox))
  const decisions = await augmentDecisions(ollamaModel, base, settings)

  const csvPath = getLastRunCsvPath()
  writeCsvReport(decisions, csvPath)

  const augmented = decisions.filter((d) => d.augmented_by_ollama).length
  const summary = `Considered ${decisions.length} item(s); ${augmented} augmented by Ollama.`

  return { decisions, summary, csvPath }
}

export function applySemanticSorterMoves(decisions: SorterDecision[]): SemanticSorterApplyResult {
  let moved = 0
  const errors: Array<{ source: string; error: string }> = []

  for (const decision of decisions) {
    try {
      if (!fs.existsSync(decision.source)) {
        errors.push({ source: decision.source, error: 'Source missing' })
        continue
      }
      const dest = uniqueDestination(decision.destination)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.renameSync(decision.source, dest)
      moved += 1
    } catch (err) {
      errors.push({
        source: decision.source,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  return { moved, errors }
}

export function saveSemanticSorterFeedback(record: SemanticSorterFeedbackRecord): void {
  const feedbackPath = getFeedbackPath()
  fs.mkdirSync(path.dirname(feedbackPath), { recursive: true })
  fs.appendFileSync(feedbackPath, JSON.stringify(record) + '\n', 'utf-8')
}

export function getSemanticSorterSettingsFromData(
  settings?: Record<string, unknown>
): SemanticSorterSettings & ReturnType<typeof mergeSemanticSorterSettings> {
  const block = (settings?.semanticSorter ?? {}) as SemanticSorterSettings
  return mergeSemanticSorterSettings(block)
}
