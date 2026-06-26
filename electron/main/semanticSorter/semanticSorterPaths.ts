import fs from 'fs'
import path from 'path'
import { app } from 'electron'

export interface SemanticSorterSettings {
  sortInboxPath?: string
  destRoot?: string
  personalRoot?: string
  hsRoot?: string
  knowledgePath?: string
  pythonPath?: string
  ollamaAugmentEnabled?: boolean
  ollamaThreshold?: number
  inspectContents?: boolean
  minConfidence?: number
  recursive?: boolean
}

export const DEFAULT_SEMANTIC_SORTER_SETTINGS: Required<
  Pick<
    SemanticSorterSettings,
    | 'ollamaAugmentEnabled'
    | 'ollamaThreshold'
    | 'inspectContents'
    | 'minConfidence'
    | 'recursive'
    | 'pythonPath'
  >
> = {
  pythonPath: 'python3',
  ollamaAugmentEnabled: true,
  ollamaThreshold: 0.62,
  inspectContents: true,
  minConfidence: 0.68,
  recursive: false
}

export function getSemanticSorterBundleDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'semantic-sorter')
  }
  return path.join(app.getAppPath(), 'semantic-sorter')
}

export function getSemanticSorterUserDir(): string {
  return path.join(app.getPath('userData'), 'semantic-sorter')
}

export function ensureSemanticSorterUserDir(): string {
  const dir = getSemanticSorterUserDir()
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function getKnowledgePath(settings?: SemanticSorterSettings): string {
  if (settings?.knowledgePath && fs.existsSync(settings.knowledgePath)) {
    return settings.knowledgePath
  }
  const userDir = ensureSemanticSorterUserDir()
  const userKnowledge = path.join(userDir, 'knowledge.json')
  if (!fs.existsSync(userKnowledge)) {
    const example = path.join(getSemanticSorterBundleDir(), 'knowledge.example.json')
    if (fs.existsSync(example)) {
      fs.copyFileSync(example, userKnowledge)
    }
  }
  return userKnowledge
}

export function getFeedbackPath(): string {
  return path.join(ensureSemanticSorterUserDir(), 'feedback.jsonl')
}

export function getLastRunCsvPath(): string {
  return path.join(ensureSemanticSorterUserDir(), 'last-run.csv')
}

export function getSortScriptPath(): string {
  return path.join(getSemanticSorterBundleDir(), 'sort_files.py')
}

export function resolveFolder(folderPath: string | null | undefined): string | null {
  if (!folderPath?.trim()) return null
  const resolved = path.resolve(folderPath.trim())
  if (!fs.existsSync(resolved)) return null
  const stat = fs.statSync(resolved)
  if (!stat.isDirectory()) return null
  return resolved
}

export function mergeSemanticSorterSettings(
  partial?: SemanticSorterSettings
): SemanticSorterSettings & typeof DEFAULT_SEMANTIC_SORTER_SETTINGS {
  return { ...DEFAULT_SEMANTIC_SORTER_SETTINGS, ...partial }
}

export function loadKnowledgeDestinations(knowledgePath: string): Record<string, string> {
  try {
    const raw = JSON.parse(fs.readFileSync(knowledgePath, 'utf-8')) as {
      destinations?: Record<string, string>
    }
    return raw.destinations ?? {}
  } catch {
    return {}
  }
}

export function loadKnowledgeAliases(knowledgePath: string): Record<string, string> {
  try {
    const raw = JSON.parse(fs.readFileSync(knowledgePath, 'utf-8')) as {
      aliases?: Record<string, string>
    }
    return raw.aliases ?? {}
  } catch {
    return {}
  }
}
