import fs from 'fs'
import path from 'path'
import { isTextFile, resolveSafePath, shouldSkipFileName } from './workplacePaths'

const PER_FILE_MAX_BYTES = 64 * 1024

export function readWorkplaceFiles(
  workplaceRoot: string,
  relativePaths: string[],
  totalMaxBytes: number
): string {
  const sections: string[] = []
  let used = 0

  for (const rel of relativePaths) {
    if (used >= totalMaxBytes) break

    const abs = resolveSafePath(workplaceRoot, rel)
    if (!abs) continue

    const base = path.basename(abs)
    if (shouldSkipFileName(base)) continue
    if (!isTextFile(abs)) continue

    let stat: fs.Stats
    try {
      stat = fs.statSync(abs)
    } catch {
      continue
    }
    if (!stat.isFile() || stat.size > PER_FILE_MAX_BYTES) continue

    let content: string
    try {
      content = fs.readFileSync(abs, 'utf-8')
    } catch {
      continue
    }

    const budget = Math.min(PER_FILE_MAX_BYTES, totalMaxBytes - used)
    if (content.length > budget) {
      content = content.slice(0, budget) + '\n... (truncated)'
    }

    sections.push(`--- ${rel} ---\n${content}`)
    used += content.length
  }

  return sections.join('\n\n')
}
