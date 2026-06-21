import { checkPhaseImbalanceAlert } from './phaseAlerts'
import { buildPhaseFocusExtension, adjustFocusForPhase } from './phaseFocusExtension'
import { buildPhaseProbeExtension, adjustProbeForPhase } from './phaseProbeExtension'
import { getPhaseBalance, recordPhaseFocusMinutes } from './phaseTime'
import type { FeatureModule, KernelDeps } from '../kernel/types'
import type { FeatureBus } from '../kernel/bus'
import { isFeatureEnabled } from '../../../../src/shared/kernel/types'

const PHASE_ALERT_COOLDOWN_MS = 30 * 60 * 1000

function taskRecord(ctx: { task: Record<string, unknown> }) {
  return ctx.task as {
    id: string
    title: string
    work_phase?: string
    phase_balance?: Record<string, unknown>
    subtasks?: Array<{ id: string; phase?: string; status?: string }>
    active_subtask_id?: string | null
  }
}

export const softwarePhasesManifest: FeatureModule = {
  id: 'softwarePhases',
  order: 30,
  hooks: {
    'probe.prompt'(ctx) {
      return buildPhaseProbeExtension(taskRecord(ctx).work_phase)
    },
    'probe.result'(ctx, result) {
      return adjustProbeForPhase(result, taskRecord(ctx).work_phase, ctx.parsed ?? {})
    },
    'focus.prompt'(ctx) {
      const task = taskRecord(ctx)
      const active = task.subtasks?.find((s) => s.id === task.active_subtask_id)
      return buildPhaseFocusExtension(task.work_phase, active?.phase)
    },
    'focus.result'(ctx, result) {
      return adjustFocusForPhase(result, taskRecord(ctx).work_phase, {
        codebase_phase_match: ctx.parsed?.codebase_phase_match as boolean | undefined,
        work_mode: (ctx.parsed?.work_mode as string) ?? result.work_mode
      })
    },
    'focus.after'(ctx) {
      const task = taskRecord(ctx)
      if (!task.work_phase || !ctx.focusResult) return
      const balance = recordPhaseFocusMinutes(getPhaseBalance(task), task.work_phase as 'playground' | 'core' | 'extract')
      ctx.task.phase_balance = balance
    }
  },
  onRegister(bus: FeatureBus, deps: KernelDeps) {
    bus.on('focus.check_complete', (ctx) => {
      if (!isFeatureEnabled(ctx.flags, 'phaseBalanceAlerts')) return
      const alert = checkPhaseImbalanceAlert(taskRecord(ctx) as Parameters<typeof checkPhaseImbalanceAlert>[0], true)
      if (!alert) return

      const nativeKey = `phase:${alert.type}:${alert.taskId}`
      const sendNative = deps.shouldSendAlert(nativeKey, PHASE_ALERT_COOLDOWN_MS)
      deps.sendNotification({ type: 'phase_alert', data: alert })
      if (sendNative) {
        void deps.showNativeNotification({
          title: `Phase — ${alert.taskTitle}`,
          body: alert.message,
          subtitle: 'Task Assistant'
        })
      }
    })
  }
}
