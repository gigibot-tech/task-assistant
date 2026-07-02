/**
 * WorktreeReviewTab — multi-day file review with LLM schedule, date coloring, checkmarks, visibility.
 */

import { useEffect, useMemo, useState } from 'react'
import type { Task } from '../store/taskStore'
import { useTaskStore } from '../store/taskStore'
import { indexWorktreeFiles, formatFileSize, type FileMetadata } from '../services/fileIndexer'
import { generateReviewSchedule } from '../lib/electron-api'
import type { FileReviewStatus } from '../types/review'
import {
  REVIEW_STATUS_COLORS,
  getReviewStatusColor,
  type ReviewStatusColor
} from '../types/review'
import { getActiveWorkplacePath, migrateTaskWorkspaces, setReviewWorkspace, addWorkspace, updateWorkspacePath, getReviewWorkspace, getReviewWorkplacePath } from '../lib/taskWorkspaces'
import WorkspaceSelector from './WorkspaceSelector'

interface WorktreeReviewTabProps {
  task: Task
  onTaskUpdated?: (task: Task) => void
}

interface TreeNode {
  name: string
  fullPath: string
  isDir: boolean
  children: TreeNode[]
  file?: FileMetadata
}

function buildTree(files: FileMetadata[]): TreeNode[] {
  const root: TreeNode = { name: '', fullPath: '', isDir: true, children: [] }
  for (const file of files) {
    const parts = file.path.split('/')
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]
      const isLast = i === parts.length - 1
      let child = node.children.find((c) => c.name === name)
      if (!child) {
        const fullPath = parts.slice(0, i + 1).join('/')
        child = { name, fullPath, isDir: !isLast, children: [] }
        if (isLast) child.file = file
        node.children.push(child)
      }
      node = child
    }
  }
  return root.children
}

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatScheduleDate(date: string): string {
  return new Date(date + 'T12:00:00').toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  })
}

function IconCheck() {
  return (
    <svg className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function IconFile({ faint }: { faint?: boolean }) {
  return (
    <svg
      className={`w-3.5 h-3.5 flex-shrink-0 ${faint ? 'text-gray-600' : 'text-gray-500'}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  )
}

function IconFolder() {
  return (
    <svg className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
    </svg>
  )
}

function IconEye({ hidden }: { hidden: boolean }) {
  if (hidden) {
    return (
      <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
        />
      </svg>
    )
  }
  return (
    <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
      />
    </svg>
  )
}

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-3 h-3 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
      fill="currentColor"
      viewBox="0 0 20 20"
    >
      <path
        fillRule="evenodd"
        d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function StatusDot({ colorKey }: { colorKey: ReviewStatusColor }) {
  const dotClass =
    colorKey === 'reviewed'
      ? 'bg-blue-400'
      : colorKey === 'overdue'
        ? 'bg-red-400'
        : colorKey === 'due_soon'
          ? 'bg-yellow-400'
          : colorKey === 'due_later'
            ? 'bg-green-400'
            : 'bg-gray-600'
  return <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotClass}`} title={REVIEW_STATUS_COLORS[colorKey].label} />
}

interface TreeRowProps {
  node: TreeNode
  depth: number
  reviewStatuses: Record<string, FileReviewStatus> | undefined
  showHidden: boolean
  expandedDirs: Set<string>
  onToggleDir: (path: string) => void
  onToggleReview: (path: string, status: FileReviewStatus | undefined) => void
  onToggleHidden: (path: string, status: FileReviewStatus | undefined) => void
}

function TreeRow({
  node,
  depth,
  reviewStatuses,
  showHidden,
  expandedDirs,
  onToggleDir,
  onToggleReview,
  onToggleHidden
}: TreeRowProps) {
  const status = reviewStatuses?.[node.fullPath]
  const isHidden = status?.hidden ?? false
  const isOpen = expandedDirs.has(node.fullPath)
  const indent = depth * 14

  if (isHidden && !showHidden) return null

  const hiddenStyle = isHidden ? 'opacity-30' : ''

  if (node.isDir) {
    return (
      <>
        <div
          className={`flex items-center gap-1 rounded cursor-pointer select-none hover:bg-gray-700/40 group ${hiddenStyle}`}
          style={{
            paddingLeft: `${8 + indent}px`,
            paddingTop: '2px',
            paddingBottom: '2px',
            paddingRight: '4px'
          }}
        >
          <span onClick={() => onToggleDir(node.fullPath)} className="flex items-center gap-1 flex-1 min-w-0">
            <IconChevron open={isOpen} />
            <IconFolder />
            <span className="text-xs text-gray-300 truncate">{node.name}</span>
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleHidden(node.fullPath, status)
            }}
            className={`opacity-0 group-hover:opacity-100 flex-shrink-0 p-0.5 rounded transition-all ${isHidden ? 'opacity-100 text-gray-600' : 'text-gray-500 hover:text-gray-300'}`}
            title={isHidden ? 'Show folder' : 'Hide folder'}
          >
            <IconEye hidden={isHidden} />
          </button>
        </div>
        {isOpen &&
          sortNodes(node.children).map((child) => (
            <TreeRow
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              reviewStatuses={reviewStatuses}
              showHidden={showHidden}
              expandedDirs={expandedDirs}
              onToggleDir={onToggleDir}
              onToggleReview={onToggleReview}
              onToggleHidden={onToggleHidden}
            />
          ))}
      </>
    )
  }

  const reviewed = status?.reviewed ?? false
  const reviewedAt = status?.reviewedAt
  const scheduledDate = status?.scheduledDate
  const colorKey = getReviewStatusColor(
    status ?? { filePath: node.fullPath, reviewed: false }
  )
  const colors = REVIEW_STATUS_COLORS[colorKey]

  return (
    <div
      className={`flex items-center gap-1.5 rounded select-none group transition-colors border border-transparent ${hiddenStyle} ${colors.bg} ${colors.border} hover:bg-gray-700/30`}
      style={{
        paddingLeft: `${8 + indent}px`,
        paddingTop: '2px',
        paddingBottom: '2px',
        paddingRight: '4px'
      }}
    >
      <StatusDot colorKey={colorKey} />
      <button
        onClick={() => onToggleReview(node.fullPath, status)}
        className="flex-shrink-0 cursor-pointer"
        title={
          reviewed
            ? `Reviewed ${reviewedAt ? formatDate(reviewedAt) : ''} — click to unmark`
            : 'Mark as reviewed'
        }
      >
        {reviewed ? <IconCheck /> : <IconFile faint={isHidden} />}
      </button>

      <span className={`text-xs font-mono truncate flex-1 min-w-0 ${colors.text}`} title={node.fullPath}>
        {node.name}
      </span>

      {scheduledDate && !reviewed && (
        <span className="text-[9px] text-gray-500 flex-shrink-0 font-mono" title="Suggested review date">
          → {formatScheduleDate(scheduledDate)}
        </span>
      )}

      {reviewed && reviewedAt && (
        <span className="text-[9px] text-blue-700/80 flex-shrink-0 font-mono">✓ {formatDate(reviewedAt)}</span>
      )}

      {!reviewed && node.file && (
        <span className="text-[9px] text-gray-600 flex-shrink-0 font-mono">
          {node.file.extension && <span className="uppercase mr-0.5">{node.file.extension}</span>}
          {formatFileSize(node.file.size)}
        </span>
      )}

      <button
        onClick={(e) => {
          e.stopPropagation()
          onToggleHidden(node.fullPath, status)
        }}
        className={`opacity-0 group-hover:opacity-100 flex-shrink-0 p-0.5 rounded transition-all ${isHidden ? 'opacity-100 text-gray-600' : 'text-gray-500 hover:text-gray-300'}`}
        title={isHidden ? 'Show file' : 'Hide file'}
      >
        <IconEye hidden={isHidden} />
      </button>
    </div>
  )
}

export default function WorktreeReviewTab({ task, onTaskUpdated }: WorktreeReviewTabProps) {
  const [files, setFiles] = useState<FileMetadata[]>([])
  const [loading, setLoading] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scheduleDays, setScheduleDays] = useState(task.review_schedule?.estimatedDays ?? 7)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [showHidden, setShowHidden] = useState(false)

  const markFileReviewed = useTaskStore((state) => state.markFileReviewed)
  const updateTask = useTaskStore((state) => state.updateTask)
  const getReviewStats = useTaskStore((state) => state.getReviewStats)
  const loadTasks = useTaskStore((state) => state.loadTasks)

  const liveTask = useTaskStore((state) => state.tasks.find((t) => t.id === task.id) ?? task)
  const normalizedTask = migrateTaskWorkspaces(liveTask)
  const reviewWorkspace = getReviewWorkspace(normalizedTask)
  const reviewWorkplacePath = getReviewWorkplacePath(normalizedTask)
  const reviewStatuses = normalizedTask.review_statuses

  const applyReviewWorkspacePatch = async (patch: Partial<Task>) => {
    await updateTask(task.id, patch)
    await syncTask()
  }

  const syncTask = async () => {
    await loadTasks()
    const updated = useTaskStore.getState().tasks.find((t) => t.id === task.id)
    if (updated) onTaskUpdated?.(updated)
  }

  const stats = useMemo(
    () => getReviewStats(task.id, files.length || undefined),
    [reviewStatuses, task.id, files.length, getReviewStats]
  )

  useEffect(() => {
    if (reviewWorkplacePath) void loadFiles()
    else setFiles([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, reviewWorkplacePath, normalizedTask.review_workspace_id, normalizedTask.active_workspace_id])

  const selectReviewWorkspace = async (workspaceId: string) => {
    const next = setReviewWorkspace(normalizedTask, workspaceId)
    await applyReviewWorkspacePatch({
      review_workspace_id: next.review_workspace_id,
      review_statuses: next.review_statuses,
      review_schedule: next.review_schedule
    })
  }

  const pickReviewFolder = async () => {
    if (!window.electron?.pickWorkplaceFolder) {
      setError('Restart the app (Cmd+Q) to enable the folder picker.')
      return
    }
    const result = await window.electron.pickWorkplaceFolder()
    if (!result.path) return

    const existing = normalizedTask.workspaces?.find((w) => w.path === result.path)
    let next = normalizedTask
    if (existing) {
      next = setReviewWorkspace(next, existing.id)
    } else if (reviewWorkspace) {
      next = updateWorkspacePath(next, reviewWorkspace.id, result.path)
      next = setReviewWorkspace(next, reviewWorkspace.id)
    } else {
      next = addWorkspace(next, result.path, { makeActive: !getActiveWorkplacePath(normalizedTask) })
      const added = next.workspaces?.find((w) => w.path === result.path)
      if (added) next = setReviewWorkspace(next, added.id)
    }

    await applyReviewWorkspacePatch({
      workspaces: next.workspaces,
      active_workspace_id: next.active_workspace_id,
      workplace_folder: next.workplace_folder,
      workplace_index: next.workplace_index,
      review_workspace_id: next.review_workspace_id,
      review_statuses: next.review_statuses,
      review_schedule: next.review_schedule
    })
  }

  const loadFiles = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await indexWorktreeFiles(task.id)
      setFiles(result.files)
      await syncTask()
      const firstLevelDirs = new Set<string>()
      for (const f of result.files) {
        const parts = f.path.split('/')
        if (parts.length > 1) firstLevelDirs.add(parts[0])
      }
      setExpandedDirs(firstLevelDirs)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to index files')
    } finally {
      setLoading(false)
    }
  }

  const handleGenerateSchedule = async () => {
    setScheduling(true)
    setError(null)
    try {
      await generateReviewSchedule(task.id, scheduleDays)
      await syncTask()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate schedule')
    } finally {
      setScheduling(false)
    }
  }

  const tree = useMemo(() => sortNodes(buildTree(files)), [files])

  const toggleDir = (dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(dirPath)) next.delete(dirPath)
      else next.add(dirPath)
      return next
    })
  }

  const toggleReview = async (filePath: string, status: FileReviewStatus | undefined) => {
    const currentlyReviewed = status?.reviewed ?? false
    if (!currentlyReviewed) {
      await markFileReviewed(task.id, filePath)
    } else {
      const current = { ...(reviewStatuses ?? {}) }
      current[filePath] = {
        ...(current[filePath] ?? { filePath, reviewed: false }),
        reviewed: false,
        reviewedAt: undefined
      }
      await updateTask(task.id, { review_statuses: current })
    }
    await syncTask()
  }

  const toggleHidden = async (path: string, status: FileReviewStatus | undefined) => {
    const current = { ...(reviewStatuses ?? {}) }
    current[path] = {
      ...(current[path] ?? { filePath: path, reviewed: false }),
      hidden: !status?.hidden
    }
    await updateTask(task.id, { review_statuses: current })
    await syncTask()
  }

  const hiddenCount = Object.values(reviewStatuses ?? {}).filter((s) => s.hidden).length

  if (!reviewWorkplacePath) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center gap-3">
        <h3 className="text-sm font-medium text-gray-400">Review workspace</h3>
        <p className="text-xs text-gray-500 max-w-sm">
          Choose a folder to review. This can differ from your active workplace workspace.
        </p>
        {(normalizedTask.workspaces?.length ?? 0) > 0 && (
          <div className="w-full max-w-md">
            <WorkspaceSelector
              task={normalizedTask}
              selectedId={normalizedTask.review_workspace_id ?? undefined}
              alwaysSelectable
              ariaLabel="Review workspace"
              onSelect={(id) => void selectReviewWorkspace(id)}
            />
          </div>
        )}
        <button
          type="button"
          onClick={() => void pickReviewFolder()}
          className="text-xs px-3 py-1.5 bg-primary-600 hover:bg-primary-700 rounded"
        >
          Choose folder…
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-gray-900">
      <div className="border-b border-gray-700 bg-gray-800 px-3 py-2 space-y-2">
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Review workspace</p>
          <div className="flex items-center gap-2 flex-wrap">
            <WorkspaceSelector
              task={normalizedTask}
              compact
              alwaysSelectable
              selectedId={normalizedTask.review_workspace_id ?? reviewWorkspace?.id}
              ariaLabel="Review workspace"
              onSelect={(id) => void selectReviewWorkspace(id)}
            />
            <button
              type="button"
              onClick={() => void pickReviewFolder()}
              className="text-[10px] px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded shrink-0"
            >
              Set folder…
            </button>
          </div>
          {reviewWorkspace?.path && (
            <p className="text-[9px] text-gray-600 font-mono truncate mt-1" title={reviewWorkspace.path}>
              {reviewWorkspace.path}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-[10px] text-gray-500">Span (days)</label>
          <input
            type="number"
            min={1}
            max={30}
            value={scheduleDays}
            onChange={(e) => setScheduleDays(Math.min(30, Math.max(1, parseInt(e.target.value, 10) || 7)))}
            className="w-14 px-1.5 py-0.5 text-xs bg-gray-700 border border-gray-600 rounded"
          />
          <button
            type="button"
            onClick={handleGenerateSchedule}
            disabled={scheduling || files.length === 0}
            className="text-[10px] px-2 py-1 bg-primary-600 hover:bg-primary-700 disabled:opacity-40 rounded"
          >
            {scheduling ? 'Planning…' : 'Generate schedule'}
          </button>
          <button
            type="button"
            onClick={loadFiles}
            disabled={loading}
            className="text-[10px] px-2 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 rounded ml-auto"
          >
            {loading ? '…' : '↺ Refresh'}
          </button>
        </div>

        {liveTask.review_schedule?.analysis && (
          <p className="text-[10px] text-gray-500">
            ~{liveTask.review_schedule.analysis.recommendedFilesPerDay} files/day ·{' '}
            {liveTask.review_schedule.analysis.complexity} complexity
          </p>
        )}

        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            {stats ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-gray-700 rounded-full h-1.5">
                  <div
                    className="bg-blue-500 h-1.5 rounded-full transition-all"
                    style={{ width: `${stats.completionPercent}%` }}
                  />
                </div>
                <span className="text-[10px] text-gray-400 flex-shrink-0 font-mono">
                  {stats.reviewedFiles}/{stats.totalFiles}
                  {stats.overdueFiles > 0 && (
                    <span className="text-red-400 ml-1">· {stats.overdueFiles} overdue</span>
                  )}
                </span>
              </div>
            ) : (
              <div className="h-1.5 bg-gray-700 rounded-full" />
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-[9px] text-gray-500">
          {(['reviewed', 'overdue', 'due_soon', 'due_later', 'unscheduled'] as ReviewStatusColor[]).map((key) => (
            <span key={key} className="flex items-center gap-1">
              <StatusDot colorKey={key} />
              {REVIEW_STATUS_COLORS[key].label}
            </span>
          ))}
        </div>

        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setShowHidden((v) => !v)}
            className={`flex items-center gap-1.5 text-[10px] px-1.5 py-0.5 rounded transition-colors ${
              showHidden
                ? 'bg-yellow-900/40 text-yellow-400'
                : 'bg-gray-700/60 text-gray-500 hover:text-gray-300'
            }`}
          >
            <IconEye hidden={!showHidden} />
            {showHidden ? `Hiding ${hiddenCount} disabled` : `Show ${hiddenCount} disabled`}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {error && (
          <div className="mx-2 my-1 px-2 py-1 bg-red-900/20 border border-red-700/40 rounded text-xs text-red-400">
            {error}
          </div>
        )}

        {loading && files.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-xs text-gray-500">Scanning…</div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-20 text-xs text-gray-500 gap-1">
            <span>No files found</span>
            <button type="button" onClick={loadFiles} className="text-blue-400 hover:text-blue-300 underline">
              Refresh
            </button>
          </div>
        ) : (
          tree.map((node) => (
            <TreeRow
              key={node.fullPath}
              node={node}
              depth={0}
              reviewStatuses={reviewStatuses}
              showHidden={showHidden}
              expandedDirs={expandedDirs}
              onToggleDir={toggleDir}
              onToggleReview={toggleReview}
              onToggleHidden={toggleHidden}
            />
          ))
        )}
      </div>

      {files.length > 0 && (
        <div className="border-t border-gray-700 bg-gray-800 px-3 py-1">
          <p className="text-[9px] text-gray-600 truncate">{activeWorkplacePath}</p>
        </div>
      )}
    </div>
  )
}
