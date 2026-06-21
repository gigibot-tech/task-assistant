import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { SoftwarePhase } from '../../../../src/features/softwarePhases/types'
import { validateWorkplaceFolder } from '../../workplace/workplacePaths'

const execFileAsync = promisify(execFile)

export interface GitCommitLine {
  hash: string
  subject: string
  timestamp: number
}

export interface GitPhaseInference {
  suggested_phase: SoftwarePhase
  confidence: number
  recent_commits_summary: string[]
  imbalance_score: number
  git_available: boolean
  commits: GitCommitLine[]
}

function inferPhaseFromSubject(subject: string): SoftwarePhase | null {
  const s = subject.toLowerCase()
  if (/\[playground\]|wip|experiment|spike|try/i.test(subject)) return 'playground'
  if (/\[core\]|refactor|extract|polish|fix/i.test(subject)) return 'core'
  if (/\[extract\]|extract/i.test(subject)) return 'extract'
  if (s.includes('wip')) return 'playground'
  return null
}

export function isGitRepo(workplaceRoot: string): boolean {
  return fs.existsSync(path.join(workplaceRoot, '.git'))
}

export async function readRecentCommits(workplaceRoot: string, limit = 30): Promise<GitCommitLine[]> {
  const { stdout } = await execFileAsync(
    'git',
    ['-C', workplaceRoot, 'log', `-n`, String(limit), '--format=%H|%s|%ct'],
    { timeout: 10000, maxBuffer: 512 * 1024 }
  )

  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash, subject, ts] = line.split('|')
      return {
        hash: hash || '',
        subject: subject || '',
        timestamp: parseInt(ts || '0', 10) * 1000
      }
    })
}

export function inferPhaseFromCommits(commits: GitCommitLine[]): GitPhaseInference {
  if (commits.length === 0) {
    return {
      suggested_phase: 'playground',
      confidence: 0.3,
      recent_commits_summary: [],
      imbalance_score: 0,
      git_available: true,
      commits: []
    }
  }

  const tagged = commits.map((c) => inferPhaseFromSubject(c.subject))
  const playgroundCount = tagged.filter((t) => t === 'playground').length
  const coreCount = tagged.filter((t) => t === 'core' || t === 'extract').length
  const untagged = tagged.filter((t) => t === null).length

  let suggested: SoftwarePhase = 'playground'
  let confidence = 0.4

  if (playgroundCount > coreCount) {
    suggested = 'playground'
    confidence = 0.5 + Math.min(0.4, playgroundCount / commits.length)
  } else if (coreCount > playgroundCount) {
    suggested = 'core'
    confidence = 0.5 + Math.min(0.4, coreCount / commits.length)
  } else if (commits.length >= 5 && untagged >= commits.length * 0.7) {
    suggested = 'playground'
    confidence = 0.55
  }

  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  const recent7d = commits.filter((c) => now - c.timestamp < 7 * day)
  const freq = recent7d.length
  const imbalance =
    playgroundCount > 0 && coreCount === 0 && freq >= 3
      ? Math.min(1, playgroundCount / Math.max(1, freq))
      : playgroundCount > coreCount * 2
        ? 0.6
        : 0

  return {
    suggested_phase: suggested,
    confidence,
    recent_commits_summary: commits.slice(0, 5).map((c) => c.subject.slice(0, 80)),
    imbalance_score: imbalance,
    git_available: true,
    commits
  }
}

export async function syncGitPhaseSignals(
  workplaceFolder: string | null | undefined
): Promise<GitPhaseInference | null> {
  const root = validateWorkplaceFolder(workplaceFolder)
  if (!root || !isGitRepo(root)) {
    return {
      suggested_phase: 'playground',
      confidence: 0,
      recent_commits_summary: [],
      imbalance_score: 0,
      git_available: false,
      commits: []
    }
  }

  try {
    const commits = await readRecentCommits(root)
    return inferPhaseFromCommits(commits)
  } catch (err) {
    console.error('[gitPhaseSignals] failed:', err)
    return {
      suggested_phase: 'playground',
      confidence: 0,
      recent_commits_summary: [],
      imbalance_score: 0,
      git_available: true,
      commits: []
    }
  }
}
