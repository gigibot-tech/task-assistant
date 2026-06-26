import path from 'path'
import fs from 'fs'
import { ollamaGenerate, parseJsonResponse } from '../ollamaClient'
import type { SorterDecision } from './semanticSorterTypes'
import { loadKnowledgeAliases, loadKnowledgeDestinations } from './semanticSorterPaths'

const TEXT_EXCERPT_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.html'])

function readExcerpt(filePath: string, maxChars = 2000): string {
  const ext = path.extname(filePath).toLowerCase()
  if (!TEXT_EXCERPT_EXTENSIONS.has(ext)) return ''
  try {
    return fs.readFileSync(filePath, 'utf-8').slice(0, maxChars)
  } catch {
    return ''
  }
}

export interface OllamaSortResult {
  category: string
  destination: string
  confidence: number
  reason: string
  tags: string[]
}

export async function augmentDecisionWithOllama(
  model: string,
  decision: SorterDecision,
  knowledgePath: string
): Promise<OllamaSortResult | null> {
  const destinations = loadKnowledgeDestinations(knowledgePath)
  const aliases = loadKnowledgeAliases(knowledgePath)
  const allowedCategories = Object.keys(destinations)
  if (allowedCategories.length === 0) return null

  const aliasLines = Object.entries(aliases)
    .slice(0, 40)
    .map(([k, v]) => `${k} -> ${v}`)
    .join('\n')

  const excerpt = readExcerpt(decision.source)
  const prompt = `You classify files on a Mac desktop/OneDrive inbox into categories.

File path: ${decision.source}
Filename: ${path.basename(decision.source)}
Extension: ${path.extname(decision.source)}
Rule-engine category: ${decision.script_category ?? decision.category}
Rule-engine confidence: ${(decision.script_confidence ?? decision.confidence).toFixed(2)}
Rule-engine reason: ${decision.reason}
${excerpt ? `\nText excerpt:\n${excerpt}\n` : ''}

Allowed categories: ${allowedCategories.join(', ')}

Destination map (category -> relative folder):
${Object.entries(destinations)
  .map(([cat, dest]) => `${cat}: ${dest}`)
  .join('\n')}

Alias hints:
${aliasLines || '(none)'}

Pick the best category and relative destination path from the map above.
If uncertain, use category "review" and destination "_Needs Review".
Respond with JSON only:
{"category":"uni","destination":"HS-Hannover/Uni/Rechnungswesen","confidence":0.78,"reason":"short reason","tags":["tag1"]}`

  try {
    // User-initiated action - show error dialog if Ollama fails
    const raw = await ollamaGenerate(model, prompt, undefined, { numPredict: 320, showErrorDialog: true })
    const parsed = parseJsonResponse<{
      category?: string
      destination?: string
      confidence?: number
      reason?: string
      tags?: string[]
    }>(raw)

    const category =
      typeof parsed.category === 'string' && allowedCategories.includes(parsed.category)
        ? parsed.category
        : 'review'

    const defaultDest = destinations[category] ?? '_Needs Review'
    let destination =
      typeof parsed.destination === 'string' && parsed.destination.trim()
        ? parsed.destination.trim()
        : defaultDest

    const knownDestinations = new Set(Object.values(destinations))
    if (!knownDestinations.has(destination) && category !== 'review') {
      destination = defaultDest
    }

    const confidence =
      typeof parsed.confidence === 'number'
        ? Math.min(0.95, Math.max(0.3, parsed.confidence))
        : 0.55

    const reason =
      typeof parsed.reason === 'string' && parsed.reason.trim()
        ? parsed.reason.trim()
        : 'Ollama classification'

    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.filter((t): t is string => typeof t === 'string').slice(0, 8)
      : []

    return { category, destination, confidence, reason, tags }
  } catch (err) {
    console.warn('[semantic-sorter] Ollama augment failed:', err)
    return null
  }
}
