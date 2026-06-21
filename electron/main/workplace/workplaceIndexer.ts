import fs from 'fs'
import path from 'path'
import {
  mergeWorkplaceSettings,
  shouldSkipDirName,
  shouldSkipFileName,
  type WorkplaceSettings
} from './workplacePaths'

export interface WorkplaceIndex {
  indexed_at: string
  file_count: number
  tree_text: string
  /** Relative paths for heuristics */
  relative_paths: string[]
}

interface WalkState {
  lines: string[]
  paths: string[]
  count: number
  maxFiles: number
  maxDepth: number
}

function walkDir(
  root: string,
  dir: string,
  depth: number,
  prefix: string,
  state: WalkState
): void {
  if (depth > state.maxDepth || state.count >= state.maxFiles) return

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  entries.sort((a, b) => a.name.localeCompare(b.name))

  for (const entry of entries) {
    if (state.count >= state.maxFiles) break

    if (entry.isDirectory()) {
      if (shouldSkipDirName(entry.name)) continue
      const rel = path.relative(root, path.join(dir, entry.name))
      state.lines.push(`${prefix}${entry.name}/`)
      state.count++
      walkDir(root, path.join(dir, entry.name), depth + 1, prefix + '  ', state)
      continue
    }

    if (!entry.isFile()) continue
    if (shouldSkipFileName(entry.name)) continue

    const rel = path.relative(root, path.join(dir, entry.name))
    state.lines.push(`${prefix}${rel}`)
    state.paths.push(rel)
    state.count++
  }
}

export function indexWorkplaceFolder(
  workplaceRoot: string,
  settings?: WorkplaceSettings
): WorkplaceIndex {
  const opts = mergeWorkplaceSettings(settings)
  const root = path.resolve(workplaceRoot)
  const folderName = path.basename(root)

  const state: WalkState = {
    lines: [`${folderName}/`],
    paths: [],
    count: 1,
    maxFiles: opts.workplaceMaxListFiles,
    maxDepth: opts.workplaceMaxDepth
  }

  walkDir(root, root, 0, '  ', state)

  let tree_text = state.lines.join('\n')
  if (state.count >= opts.workplaceMaxListFiles) {
    tree_text += '\n  ... (listing truncated)'
  }

  return {
    indexed_at: new Date().toISOString(),
    file_count: state.paths.length,
    tree_text,
    relative_paths: state.paths
  }
}
