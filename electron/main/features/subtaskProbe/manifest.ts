import type { FeatureModule, KernelDeps } from '../kernel/types'
import type { FeatureBus } from '../kernel/bus'
import { isFeatureEnabled } from '../../../../src/shared/kernel/types'

const STUCK_PROBE_COOLDOWN_MS = 30 * 60 * 1000

export const subtaskProbeManifest: FeatureModule = {
  id: 'subtaskProbe',
  order: 20,
  hooks: {},
  onRegister(bus: FeatureBus, deps: KernelDeps) {
    bus.on('deviation.alert', (ctx) => {
      if (!isFeatureEnabled(ctx.flags, 'subtaskProbe')) return
      const task = ctx.task as { id: string; title: string }
      const stuckKey = `stuck_probe:${task.id}`
      if (!deps.shouldSendAlert(stuckKey, STUCK_PROBE_COOLDOWN_MS)) return
      deps.sendNotification({
        type: 'stuck_probe_offer',
        data: { taskId: task.id, taskTitle: task.title, trigger: 'deviation' }
      })
    })
  }
}
