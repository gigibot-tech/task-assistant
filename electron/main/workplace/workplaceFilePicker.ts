import fs from 'fs'
import path from 'path'
import { ollamaGenerate, parseJsonResponse } from '../ollamaClient'
import { formatPlannedTask, type TaskFocusContext } from '../activityAnalysis'
import { isTextFile } from './workplacePaths'
import type { WorkplaceIndex } from './workplaceIndexer'

const MAX_PICK = 5

function heuristicPickFiles(index: WorkplaceIndex): string[] {
  const paths = index.relative_paths
  const picked: string[] = []

  const prefer = (name: string) => {
    const match = paths.find((p) => p === name || p.endsWith(`/${name}`))
    if (match && !picked.includes(match)) picked.push(match)
  }

  prefer('README.md')
  prefer('package.json')
  prefer('pyproject.toml')
  prefer('Cargo.toml')
  prefer('go.mod')

  const srcFiles = paths
    .filter((p) => isTextFile(p) && (p.startsWith('src/') || p.includes('/src/')))
    .map((p) => {
      const abs = path.join(workplaceRoot, p)
      let mtime = 0
      try {
        mtime = fs.statSync(abs).mtimeMs
      } catch {
        /* skip */
      }
      return { p, mtime }
    })
    .sort((a, b) => b.mtime - a.mtime)

  for (const { p } of srcFiles) {
    if (picked.length >= MAX_PICK) break
    if (!picked.includes(p)) picked.push(p)
  }

  for (const p of paths) {
    if (picked.length >= MAX_PICK) break
    if (isTextFile(p) && !picked.includes(p)) picked.push(p)
  }

  return picked.slice(0, MAX_PICK)
}

export async function pickWorkplaceFiles(
  model: string,
  task: TaskFocusContext,
  index: WorkplaceIndex,
  workplaceRoot: string
): Promise<string[]> {
  const planned = formatPlannedTask(task)
  const prompt = `You help pick files from a project folder to understand what the user should work on.

Planned task:
${planned}

Project file tree:
${index.tree_text.slice(0, 12000)}

Pick up to ${MAX_PICK} relative file paths from the tree that are most relevant for continuing this task.
Only use paths that appear in the tree. Prefer source code, README, and config over lockfiles.

Respond with JSON only: {"files":["relative/path.ts"]}`

  try {
    const raw = await ollamaGenerate(model, prompt, undefined, { numPredict: 256 })
    const parsed = parseJsonResponse<{ files?: string[] }>(raw)
    const files = Array.isArray(parsed.files) ? parsed.files : []

    const valid = files
      .filter((f) => typeof f === 'string' && f.trim())
      .map((f) => f.replace(/^\/+/, ''))
      .filter((f) => index.relative_paths.includes(f) || index.relative_paths.some((p) => p.endsWith(f)))
      .slice(0, MAX_PICK)

    if (valid.length > 0) return valid
  } catch (err) {
    console.warn('[workplace] File picker LLM failed, using heuristics:', err)
  }

  return heuristicPickFiles(index)
}
