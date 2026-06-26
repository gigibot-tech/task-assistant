import { useEffect, useState } from 'react'
import {
  THINKING_BAND_LABELS,
  type ThinkingBand,
  type WastedStats
} from '../lib/subtaskTypes'
import { formatWastedDuration, todayDateKey, weekKey } from '../lib/wastedTimeDisplay'
import { getTaskTimeStatus } from '../lib/electron-api'
import { formatDuration } from '../lib/timeFormat'

interface TaskAnalytics {
  totalTasks: number
  completedTasks: number
  inProgressTasks: number
  totalTimeSpent: number
  averageCompletionTime: number
  deviationRate: number
  mostProductiveHours: string[]
  tasksByPriority: {
    high: number
    medium: number
    low: number
  }
}

interface ScreenshotAnalysis {
  timestamp: string
  imagePath: string
  aiPrediction: string
  recommendation: string
  deviationScore: number
  activityLabel: string
}

interface TaskWithHistory {
  id: string
  title: string
  status: string
  screenshots: ScreenshotAnalysis[]
  timeSpent: number
  recorded_seconds?: number
  actual_minutes?: number
  work_sessions?: Array<{ id: string; started_at: string; ended_at?: string | null }>
  completedAt?: string
}

function taskRecordedMinutes(task: TaskWithHistory): number {
  if (typeof task.recorded_seconds === 'number') {
    return task.recorded_seconds / 60
  }
  if (typeof task.actual_minutes === 'number') {
    return task.actual_minutes
  }
  return task.timeSpent || 0
}

export function TaskAnalytics() {
  const [analytics, setAnalytics] = useState<TaskAnalytics | null>(null)
  const [taskHistory, setTaskHistory] = useState<TaskWithHistory[]>([])
  const [selectedTask, setSelectedTask] = useState<TaskWithHistory | null>(null)
  const [loading, setLoading] = useState(true)
  const [estimateAccuracy, setEstimateAccuracy] = useState<
    Array<{ title: string; estimated: number; actual: number; ratio: number }>
  >([])
  const [wastedStats, setWastedStats] = useState<WastedStats | null>(null)
  const [stuckEvents7d, setStuckEvents7d] = useState(0)
  const [phaseTotals, setPhaseTotals] = useState<{
    playground: number
    core: number
    extracts: number
  } | null>(null)
  const [softwarePhasesEnabled, setSoftwarePhasesEnabled] = useState(false)
  const [breakTotals, setBreakTotals] = useState<{
    totalBreakSeconds: number
    totalPauseSeconds: number
  } | null>(null)
  const [recentTaskTime, setRecentTaskTime] = useState<{
    title: string
    workSeconds: number
    breakSeconds: number
    pauseSeconds: number
    sessionCount: number
  } | null>(null)

  useEffect(() => {
    loadAnalytics()
  }, [])

  const loadAnalytics = async () => {
    try {
      const [tasks, settings] = await Promise.all([
        window.electron.getTasks(),
        window.electron.getSettings()
      ])
      
      // Calculate analytics
      const completed = tasks.filter((t: any) => t.status === 'completed')
      const inProgress = tasks.filter((t: any) => t.status === 'in_progress')
      
      const analytics: TaskAnalytics = {
        totalTasks: tasks.length,
        completedTasks: completed.length,
        inProgressTasks: inProgress.length,
        totalTimeSpent: tasks.reduce(
          (sum: number, t: TaskWithHistory) => sum + taskRecordedMinutes(t),
          0
        ),
        averageCompletionTime: completed.length > 0
          ? completed.reduce((sum: number, t: TaskWithHistory) => sum + taskRecordedMinutes(t), 0) /
            completed.length
          : 0,
        deviationRate: tasks.reduce((sum: number, t: any) => 
          sum + (t.screenshots?.filter((s: any) => s.deviationScore > 0.5).length || 0), 0
        ) / Math.max(tasks.reduce((sum: number, t: any) => sum + (t.screenshots?.length || 0), 0), 1),
        mostProductiveHours: calculateProductiveHours(tasks),
        tasksByPriority: {
          high: tasks.filter((t: any) => t.priority === 'high').length,
          medium: tasks.filter((t: any) => t.priority === 'medium').length,
          low: tasks.filter((t: any) => t.priority === 'low').length
        }
      }

      setAnalytics(analytics)
      setTaskHistory(tasks)
      setEstimateAccuracy(
        completed
          .map((t: any) => {
            const estimated =
              t.user_estimate_minutes ?? t.ai_estimate_minutes ?? t.estimated_minutes
            const actual = Math.round(taskRecordedMinutes(t))
            if (!estimated || actual <= 0) return null
            return {
              title: t.title as string,
              estimated,
              actual,
              ratio: actual / estimated
            }
          })
          .filter(Boolean) as Array<{
          title: string
          estimated: number
          actual: number
          ratio: number
        }>
      )

      const stats = (settings.wasted_stats as WastedStats | undefined) ?? {
        by_day: {},
        by_week: {},
        by_thinking_band: {},
        off_task_episode_count: 0
      }
      setWastedStats(stats)

      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
      const stuckCount = tasks.reduce((sum: number, t: { stuck_events?: Array<{ recorded_at: string }> }) => {
        const events = t.stuck_events ?? []
        return sum + events.filter((e) => new Date(e.recorded_at).getTime() >= weekAgo).length
      }, 0)
      setStuckEvents7d(stuckCount)

      const flags = settings.featureFlags as { softwarePhases?: boolean } | undefined
      const phasesOn = flags?.softwarePhases === true
      setSoftwarePhasesEnabled(phasesOn)
      if (phasesOn) {
        let playground = 0
        let core = 0
        let extracts = 0
        for (const t of tasks) {
          const b = t.phase_balance
          if (!b) continue
          playground += b.playground_minutes_7d ?? 0
          core += b.core_minutes_7d ?? 0
          extracts += b.extract_events_7d ?? 0
        }
        setPhaseTotals({ playground, core, extracts })
      } else {
        setPhaseTotals(null)
      }

      const tasksWithSessions = tasks.filter(
        (t: TaskWithHistory) => (t.work_sessions?.length ?? 0) > 0
      )
      let totalBreak = 0
      let totalPause = 0
      let recentTask: TaskWithHistory | null = null
      let recentMs = 0
      let recentStatus: Awaited<ReturnType<typeof getTaskTimeStatus>> = null

      for (const t of tasksWithSessions) {
        const status = await getTaskTimeStatus(t.id)
        if (!status) continue
        totalBreak += status.breakSeconds
        totalPause += status.pauseSeconds

        const sessions = t.work_sessions ?? []
        const lastMs = Math.max(
          ...sessions.map((s) =>
            Math.max(
              new Date(s.started_at).getTime(),
              s.ended_at ? new Date(s.ended_at).getTime() : Date.now()
            )
          )
        )
        if (lastMs >= recentMs) {
          recentMs = lastMs
          recentTask = t
          recentStatus = status
        }
      }

      setBreakTotals({ totalBreakSeconds: totalBreak, totalPauseSeconds: totalPause })
      if (recentTask && recentStatus) {
        setRecentTaskTime({
          title: recentTask.title,
          workSeconds: recentStatus.liveSeconds,
          breakSeconds: recentStatus.breakSeconds,
          pauseSeconds: recentStatus.pauseSeconds,
          sessionCount: recentStatus.sessionCount
        })
      } else {
        setRecentTaskTime(null)
      }
    } catch (error) {
      console.error('Failed to load analytics:', error)
    } finally {
      setLoading(false)
    }
  }

  const calculateProductiveHours = (tasks: any[]): string[] => {
    const hourCounts: Record<number, number> = {}
    
    tasks.forEach(task => {
      task.screenshots?.forEach((screenshot: any) => {
        const hour = new Date(screenshot.timestamp).getHours()
        hourCounts[hour] = (hourCounts[hour] || 0) + 1
      })
    })

    return Object.entries(hourCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([hour]) => `${hour}:00`)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading analytics...</div>
      </div>
    )
  }

  if (!analytics) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">No data available</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Overview Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          title="Total Tasks"
          value={analytics.totalTasks}
          icon="📋"
        />
        <StatCard
          title="Completed"
          value={analytics.completedTasks}
          icon="✅"
          color="green"
        />
        <StatCard
          title="In Progress"
          value={analytics.inProgressTasks}
          icon="⏳"
          color="blue"
        />
        <StatCard
          title="Deviation Rate"
          value={`${(analytics.deviationRate * 100).toFixed(1)}%`}
          icon="📊"
          color={analytics.deviationRate > 0.3 ? 'red' : 'green'}
        />
      </div>

      {/* Time Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard
          title="Total Time"
          value={`${Math.round(analytics.totalTimeSpent / 60)}h`}
          icon="⏱️"
        />
        <StatCard
          title="Avg Completion"
          value={`${Math.round(analytics.averageCompletionTime)}m`}
          icon="📈"
        />
        <StatCard
          title="Most Productive"
          value={analytics.mostProductiveHours.join(', ')}
          icon="🌟"
        />
      </div>

      {breakTotals && (
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Work · break · pause</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
            <StatCard
              title="Total break (all tasks)"
              value={formatDuration(breakTotals.totalBreakSeconds)}
              icon="☕"
              color="blue"
            />
            <StatCard
              title="Total paused (all tasks)"
              value={formatDuration(breakTotals.totalPauseSeconds)}
              icon="⏸"
            />
          </div>
          {recentTaskTime && (
            <div className="p-4 rounded-lg bg-amber-900/20 border border-amber-700/40">
              <p className="text-xs text-amber-400 font-medium mb-2">Most recent task</p>
              <p className="text-sm font-semibold text-white mb-1">{recentTaskTime.title}</p>
              <p className="text-xs text-gray-300 font-mono">
                {formatDuration(recentTaskTime.workSeconds)} work ·{' '}
                {formatDuration(recentTaskTime.breakSeconds)} break ·{' '}
                {formatDuration(recentTaskTime.pauseSeconds)} paused ·{' '}
                {recentTaskTime.sessionCount} sessions
              </p>
            </div>
          )}
        </div>
      )}

      {wastedStats && (
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Wasted time</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <StatCard
              title="Wasted today"
              value={formatWastedDuration(wastedStats.by_day[todayDateKey()] ?? 0)}
              icon="📉"
              color="red"
            />
            <StatCard
              title="Wasted this week"
              value={formatWastedDuration(wastedStats.by_week[weekKey()] ?? 0)}
              icon="📅"
            />
            <StatCard
              title="Stuck events (7d)"
              value={stuckEvents7d}
              icon="🧱"
            />
            <StatCard
              title="Off-task episodes"
              value={wastedStats.off_task_episode_count}
              icon="↩️"
            />
          </div>
          <h4 className="text-sm font-medium text-gray-400 mb-2">By thinking band (lifetime)</h4>
          <div className="space-y-2">
            {(Object.keys(THINKING_BAND_LABELS) as ThinkingBand[]).map((band) => {
              const seconds = wastedStats.by_thinking_band[band] ?? 0
              const max = Math.max(
                ...Object.values(wastedStats.by_thinking_band),
                1
              )
              const pct = (seconds / max) * 100
              return (
                <div key={band}>
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>{THINKING_BAND_LABELS[band]}</span>
                    <span>{formatWastedDuration(seconds)}</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-orange-500 h-2 rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-4 pt-4 border-t border-gray-700">
            <h4 className="text-sm font-medium text-gray-400 mb-2">Per task</h4>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {taskHistory
                .filter((t) => (t as TaskWithHistory & { wasted_time_seconds?: number }).wasted_time_seconds)
                .map((t) => {
                  const wasted = (t as TaskWithHistory & { wasted_time_seconds?: number })
                    .wasted_time_seconds ?? 0
                  const activeId = (t as TaskWithHistory & { active_subtask_id?: string })
                    .active_subtask_id
                  const active = (t as TaskWithHistory & { subtasks?: Array<{ id: string; title: string }> })
                    .subtasks?.find((s) => s.id === activeId)
                  return (
                    <div
                      key={t.id}
                      className="flex justify-between text-xs text-gray-300 py-1 border-b border-gray-700/40"
                    >
                      <span className="truncate pr-2">
                        {t.title}
                        {active && (
                          <span className="text-gray-500"> · {active.title}</span>
                        )}
                      </span>
                      <span className="shrink-0 font-mono text-orange-300">
                        {formatWastedDuration(wasted)}
                      </span>
                    </div>
                  )
                })}
              {taskHistory.every(
                (t) => !(t as TaskWithHistory & { wasted_time_seconds?: number }).wasted_time_seconds
              ) && (
                <p className="text-xs text-gray-600">No per-task wasted time recorded yet.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {softwarePhasesEnabled && phaseTotals && (
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Phase balance (7d)</h3>
          <div className="grid grid-cols-3 gap-4">
            <StatCard title="Playground" value={`${phaseTotals.playground}m`} icon="🧪" />
            <StatCard title="Core" value={`${phaseTotals.core}m`} icon="🧱" />
            <StatCard title="Extracts" value={phaseTotals.extracts} icon="📤" />
          </div>
        </div>
      )}

      {estimateAccuracy.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Estimate vs actual (completed)</h3>
          <div className="space-y-2">
            {estimateAccuracy.slice(0, 8).map((row) => (
              <div
                key={row.title}
                className="flex items-center justify-between text-sm text-gray-300 border-b border-gray-700/60 pb-2"
              >
                <span className="truncate pr-4">{row.title}</span>
                <span className="shrink-0 font-mono text-xs">
                  est {row.estimated}m · actual {row.actual}m ·{' '}
                  <span className={row.ratio > 1.2 ? 'text-orange-300' : 'text-green-300'}>
                    {row.ratio.toFixed(2)}×
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Priority Distribution */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Tasks by Priority</h3>
        <div className="space-y-3">
          <PriorityBar
            label="High"
            count={analytics.tasksByPriority.high}
            total={analytics.totalTasks}
            color="red"
          />
          <PriorityBar
            label="Medium"
            count={analytics.tasksByPriority.medium}
            total={analytics.totalTasks}
            color="yellow"
          />
          <PriorityBar
            label="Low"
            count={analytics.tasksByPriority.low}
            total={analytics.totalTasks}
            color="green"
          />
        </div>
      </div>

      {/* Task History with Screenshots */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Task History</h3>
        <div className="space-y-4">
          {taskHistory.map(task => (
            <TaskHistoryCard
              key={task.id}
              task={task}
              onClick={() => setSelectedTask(task)}
              isSelected={selectedTask?.id === task.id}
            />
          ))}
        </div>
      </div>

      {/* Selected Task Details */}
      {selectedTask && (
        <TaskDetailsModal
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
  )
}

function StatCard({ title, value, icon, color = 'gray' }: any) {
  const colorClasses = {
    gray: 'bg-gray-700',
    green: 'bg-green-900/50 border-green-500',
    blue: 'bg-blue-900/50 border-blue-500',
    red: 'bg-red-900/50 border-red-500'
  }

  return (
    <div className={`${colorClasses[color]} rounded-lg p-4 border border-gray-700`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-2xl">{icon}</span>
        <span className="text-2xl font-bold text-white">{value}</span>
      </div>
      <div className="text-sm text-gray-400">{title}</div>
    </div>
  )
}

function PriorityBar({ label, count, total, color }: any) {
  const percentage = total > 0 ? (count / total) * 100 : 0
  
  const colorClasses = {
    red: 'bg-red-500',
    yellow: 'bg-yellow-500',
    green: 'bg-green-500'
  }

  return (
    <div>
      <div className="flex justify-between text-sm text-gray-400 mb-1">
        <span>{label}</span>
        <span>{count} tasks ({percentage.toFixed(0)}%)</span>
      </div>
      <div className="w-full bg-gray-700 rounded-full h-2">
        <div
          className={`${colorClasses[color]} h-2 rounded-full transition-all`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}

function TaskHistoryCard({ task, onClick, isSelected }: any) {
  return (
    <div
      onClick={onClick}
      className={`p-4 rounded-lg cursor-pointer transition-all ${
        isSelected ? 'bg-blue-900/50 border-blue-500' : 'bg-gray-700 hover:bg-gray-600'
      } border border-gray-600`}
    >
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-semibold text-white">{task.title}</h4>
        <span className={`px-2 py-1 rounded text-xs ${
          task.status === 'completed' ? 'bg-green-900 text-green-200' :
          task.status === 'in_progress' ? 'bg-blue-900 text-blue-200' :
          'bg-gray-600 text-gray-300'
        }`}>
          {task.status}
        </span>
      </div>
      <div className="flex items-center gap-4 text-sm text-gray-400">
        <span>📸 {task.screenshots?.length || 0} screenshots</span>
        <span>⏱️ {Math.round(taskRecordedMinutes(task))}m</span>
        {(task.work_sessions?.length ?? 0) > 0 && (
          <span>🕐 {task.work_sessions!.length} sessions</span>
        )}
        {task.completedAt && (
          <span>✅ {new Date(task.completedAt).toLocaleDateString()}</span>
        )}
      </div>
    </div>
  )
}

function TaskDetailsModal({ task, onClose }: any) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-gray-800 border-b border-gray-700 p-6 flex justify-between items-center">
          <h2 className="text-2xl font-bold text-white">{task.title}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-2xl"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Task Info */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-gray-700 rounded-lg p-4">
              <div className="text-gray-400 text-sm">Status</div>
              <div className="text-white font-semibold">{task.status}</div>
            </div>
            <div className="bg-gray-700 rounded-lg p-4">
              <div className="text-gray-400 text-sm">Time Spent</div>
              <div className="text-white font-semibold">{Math.round(taskRecordedMinutes(task))}m</div>
            </div>
            <div className="bg-gray-700 rounded-lg p-4">
              <div className="text-gray-400 text-sm">Screenshots</div>
              <div className="text-white font-semibold">{task.screenshots?.length || 0}</div>
            </div>
          </div>

          {/* Screenshot History */}
          <div>
            <h3 className="text-lg font-semibold text-white mb-4">Screenshot History</h3>
            {task.screenshots && task.screenshots.length > 0 ? (
              <div className="space-y-4">
                {task.screenshots.map((screenshot: ScreenshotAnalysis, index: number) => (
                  <ScreenshotCard key={index} screenshot={screenshot} />
                ))}
              </div>
            ) : (
              <div className="text-gray-400 text-center py-8">
                No screenshots captured for this task yet
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ScreenshotCard({ screenshot }: { screenshot: ScreenshotAnalysis }) {
  return (
    <div className="bg-gray-700 rounded-lg p-4">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 w-32 h-24 bg-gray-600 rounded-lg flex items-center justify-center">
          <span className="text-4xl">📸</span>
        </div>
        <div className="flex-1 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">
              {new Date(screenshot.timestamp).toLocaleString()}
            </span>
            <span className={`px-2 py-1 rounded text-xs ${
              screenshot.deviationScore > 0.7 ? 'bg-red-900 text-red-200' :
              screenshot.deviationScore > 0.4 ? 'bg-yellow-900 text-yellow-200' :
              'bg-green-900 text-green-200'
            }`}>
              {screenshot.deviationScore > 0.7 ? 'High Deviation' :
               screenshot.deviationScore > 0.4 ? 'Medium Deviation' :
               'On Track'}
            </span>
          </div>
          
          <div>
            <div className="text-white font-semibold mb-1">AI Prediction:</div>
            <div className="text-gray-300 text-sm">{screenshot.aiPrediction}</div>
          </div>

          <div>
            <div className="text-white font-semibold mb-1">Activity Label:</div>
            <div className="text-blue-300 text-sm">{screenshot.activityLabel}</div>
          </div>

          <div>
            <div className="text-white font-semibold mb-1">Recommendation:</div>
            <div className="text-gray-300 text-sm">{screenshot.recommendation}</div>
          </div>

          <div className="text-xs text-gray-500">
            {screenshot.imagePath}
          </div>
        </div>
      </div>
    </div>
  )
}

// Made with Bob
