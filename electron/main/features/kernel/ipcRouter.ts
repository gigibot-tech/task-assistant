import type { IpcMain } from 'electron'
import { syncGitPhaseSignals } from '../softwarePhases/gitPhaseSignals'
import { getPhaseBalance } from '../softwarePhases/phaseTime'
import { getActiveWorkplacePath, normalizeTaskWorkspaces } from '../../../../src/shared/workplace/workspaces'
import {
  getFeatureFlagsFromSettings,
  isFeatureEnabled,
  type FeatureFlags
} from '../../../../src/shared/kernel/types'

export interface FeatureIpcDeps {
  readData: () => { tasks?: Array<Record<string, unknown>>; settings?: Record<string, unknown> }
  writeData: (data: Record<string, unknown>) => void
  getFeatureFlags: () => FeatureFlags
}

export function registerFeatureIpc(ipcMain: IpcMain, deps: FeatureIpcDeps): void {
  ipcMain.handle('get-feature-flags', async () => {
    return deps.getFeatureFlags()
  })

  ipcMain.handle(
    'set-work-phase',
    async (
      _: unknown,
      taskId: string,
      phase: string,
      source: 'user' | 'git' | 'probe' = 'user'
    ) => {
      const data = deps.readData()
      const taskIndex = (data.tasks || []).findIndex((t) => t.id === taskId)
      if (taskIndex === -1) throw new Error('Task not found')

      const task = data.tasks![taskIndex]
      data.tasks![taskIndex] = {
        ...task,
        work_phase: phase,
        work_phase_set_at: new Date().toISOString(),
        work_phase_source: source,
        updated_at: new Date().toISOString()
      }
      deps.writeData(data)
      return data.tasks![taskIndex]
    }
  )

  ipcMain.handle('sync-phase-git-signals', async (_: unknown, taskId: string) => {
    const data = deps.readData()
    const flags = getFeatureFlagsFromSettings(
      data.settings as { featureFlags?: Partial<FeatureFlags> }
    )
    if (!isFeatureEnabled(flags, 'phaseGitSignals')) {
      return { git_available: false, suggested_phase: 'playground', confidence: 0 }
    }

    const taskIndex = (data.tasks || []).findIndex((t) => t.id === taskId)
    if (taskIndex === -1) throw new Error('Task not found')

    const task = normalizeTaskWorkspaces(data.tasks![taskIndex] as Record<string, unknown>)
    const inference = await syncGitPhaseSignals(getActiveWorkplacePath(task))
    if (!inference) throw new Error('Git sync failed')

    const balance = {
      ...getPhaseBalance(task),
      last_git_sync_at: new Date().toISOString(),
      last_inferred_phase: inference.suggested_phase,
      git_available: inference.git_available,
      git_suggested_phase: inference.suggested_phase,
      git_confidence: inference.confidence,
      recent_commits_summary: inference.recent_commits_summary,
      imbalance_score: inference.imbalance_score
    }

    data.tasks![taskIndex] = {
      ...task,
      phase_balance: balance,
      updated_at: new Date().toISOString()
    }
    deps.writeData(data)

    return {
      ...inference,
      phase_balance: balance
    }
  })
}
