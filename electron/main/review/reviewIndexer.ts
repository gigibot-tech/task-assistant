import fs from 'fs'
import path from 'path'
import {
  mergeWorkplaceSettings,
  shouldSkipDirName,
  shouldSkipFileName,
  type WorkplaceSettings
} from '../workplace/workplacePaths'

export interface ReviewFileEntry {
  path: string
  size: number
  extension: string
  lastModified?: string
}

export interface ReviewIndexResult {
  files: ReviewFileEntry[]
  totalFiles: number
  indexedAt: string
  errors?: string[]
}

interface WalkState {
  files: ReviewFileEntry[]
  errors: string[]
  count: number
  maxFiles: number
  maxDepth: number
}

function walkDir(root: string, dir: string, depth: number, state: WalkState): void {
  if (depth > state.maxDepth || state.count >= state.maxFiles) return

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    state.errors.push(`Failed to read directory ${dir}: ${err}`)
    return
  }

  entries.sort((a, b) => a.name.localeCompare(b.name))

  for (const entry of entries) {
    if (state.count >= state.maxFiles) break

    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (shouldSkipDirName(entry.name)) continue
      walkDir(root, fullPath, depth + 1, state)
      continue
    }

    if (!entry.isFile()) continue
    if (shouldSkipFileName(entry.name)) continue
    if (entry.name.endsWith('.lock')) continue

    const relativePath = path.relative(root, fullPath)
    try {
      const stats = fs.statSync(fullPath)
      const ext = path.extname(entry.name).slice(1) || 'no-ext'
      state.files.push({
        path: relativePath,
        size: stats.size,
        extension: ext,
        lastModified: stats.mtime.toISOString()
      })
      state.count++
    } catch (err) {
      state.errors.push(`Failed to stat ${relativePath}: ${err}`)
    }
  }
}

export function indexReviewWorktree(
  workplaceRoot: string,
  settings?: WorkplaceSettings
): ReviewIndexResult {
  const opts = mergeWorkplaceSettings(settings)
  const root = path.resolve(workplaceRoot)

  const state: WalkState = {
    files: [],
    errors: [],
    count: 0,
    maxFiles: opts.workplaceMaxListFiles,
    maxDepth: opts.workplaceMaxDepth
  }

  walkDir(root, root, 0, state)

  return {
    files: state.files,
    totalFiles: state.files.length,
    indexedAt: new Date().toISOString(),
    errors: state.errors.length > 0 ? state.errors : undefined
  }
}
