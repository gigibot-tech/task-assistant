import fs from 'fs'
import path from 'path'

const SKIP_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'out',
  'build',
  '.next',
  '__pycache__',
  '.venv',
  'venv',
  'coverage',
  '.cache'
])

const SKIP_FILE_PATTERNS = [
  /^\.env/i,
  /\.pem$/i,
  /id_rsa/i,
  /\.key$/i,
  /\.p12$/i
]

export const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.mdx',
  '.txt',
  '.yaml',
  '.yml',
  '.toml',
  '.css',
  '.scss',
  '.html',
  '.xml',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.swift',
  '.sh',
  '.sql',
  '.graphql',
  '.vue',
  '.svelte'
])

export function validateWorkplaceFolder(folderPath: string | null | undefined): string | null {
  if (!folderPath?.trim()) return null
  const resolved = path.resolve(folderPath.trim())
  if (!fs.existsSync(resolved)) return null
  const stat = fs.statSync(resolved)
  if (!stat.isDirectory()) return null
  return resolved
}

export function resolveSafePath(workplaceRoot: string, relativePath: string): string | null {
  const root = path.resolve(workplaceRoot)
  const target = path.resolve(root, relativePath.replace(/^\/+/, ''))

  if (target !== root && !target.startsWith(root + path.sep)) {
    return null
  }

  if (!fs.existsSync(target)) return null
  return target
}

export function shouldSkipDirName(name: string): boolean {
  return SKIP_DIR_NAMES.has(name) || name.startsWith('.') && name !== '.'
}

export function shouldSkipFileName(name: string): boolean {
  return SKIP_FILE_PATTERNS.some((re) => re.test(name))
}

export function isTextFile(filePath: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

export interface WorkplaceSettings {
  workplaceMaxListFiles?: number
  workplaceMaxReadBytes?: number
  workplaceMaxDepth?: number
}

export function defaultWorkplaceSettings(): Required<WorkplaceSettings> {
  return {
    workplaceMaxListFiles: 150,
    workplaceMaxReadBytes: 24000,
    workplaceMaxDepth: 4
  }
}

export function mergeWorkplaceSettings(
  partial?: WorkplaceSettings
): Required<WorkplaceSettings> {
  const defaults = defaultWorkplaceSettings()
  return {
    workplaceMaxListFiles: partial?.workplaceMaxListFiles ?? defaults.workplaceMaxListFiles,
    workplaceMaxReadBytes: partial?.workplaceMaxReadBytes ?? defaults.workplaceMaxReadBytes,
    workplaceMaxDepth: partial?.workplaceMaxDepth ?? defaults.workplaceMaxDepth
  }
}
