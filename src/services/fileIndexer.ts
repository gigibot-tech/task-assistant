/**
 * File Indexer Service
 * Scans worktree directories and returns file lists for review tracking
 */

import type { FileReviewStatus } from '../types/review'

export interface FileMetadata {
  path: string
  size: number
  extension: string
  lastModified?: string
}

export interface IndexResult {
  files: FileMetadata[]
  totalFiles: number
  indexedAt: string
  errors?: string[]
}

/**
 * Index files in a worktree directory via Electron IPC
 * This will be called from the renderer process
 */
export async function indexWorktreeFiles(taskId: string): Promise<IndexResult> {
  if (!window.electron?.indexWorktreeFiles) {
    throw new Error('File indexing not available - Electron IPC not ready')
  }

  try {
    const result = await window.electron.indexWorktreeFiles(taskId)
    return result
  } catch (error) {
    console.error('Failed to index worktree files:', error)
    throw error
  }
}

/**
 * Initialize review statuses for newly indexed files
 * Merges with existing statuses to preserve review progress
 */
export function initializeReviewStatuses(
  indexedFiles: FileMetadata[],
  existingStatuses?: Record<string, FileReviewStatus>
): Record<string, FileReviewStatus> {
  const statuses: Record<string, FileReviewStatus> = {}

  for (const file of indexedFiles) {
    const existing = existingStatuses?.[file.path]
    
    if (existing) {
      statuses[file.path] = {
        ...existing,
        metadata: {
          size: file.size,
          extension: file.extension,
          lastModified: file.lastModified
        }
      }
    } else {
      statuses[file.path] = {
        filePath: file.path,
        reviewed: false,
        metadata: {
          size: file.size,
          extension: file.extension,
          lastModified: file.lastModified
        }
      }
    }
  }

  return statuses
}

/**
 * Filter files by extension
 */
export function filterFilesByExtension(
  files: FileMetadata[],
  extensions: string[]
): FileMetadata[] {
  const extSet = new Set(extensions.map(ext => ext.toLowerCase()))
  return files.filter(f => extSet.has(f.extension.toLowerCase()))
}

/**
 * Sort files by various criteria
 */
export function sortFiles(
  files: FileMetadata[],
  sortBy: 'name' | 'size' | 'extension' | 'modified'
): FileMetadata[] {
  const sorted = [...files]
  
  switch (sortBy) {
    case 'name':
      sorted.sort((a, b) => a.path.localeCompare(b.path))
      break
    case 'size':
      sorted.sort((a, b) => b.size - a.size)
      break
    case 'extension':
      sorted.sort((a, b) => {
        const extCompare = a.extension.localeCompare(b.extension)
        return extCompare !== 0 ? extCompare : a.path.localeCompare(b.path)
      })
      break
    case 'modified':
      sorted.sort((a, b) => {
        if (!a.lastModified || !b.lastModified) return 0
        return new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
      })
      break
  }
  
  return sorted
}

/**
 * Get file extension from path
 */
export function getFileExtension(path: string): string {
  const parts = path.split('.')
  return parts.length > 1 ? parts[parts.length - 1] : ''
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Math.round(bytes / Math.pow(k, i) * 100) / 100} ${sizes[i]}`
}

// Made with Bob
