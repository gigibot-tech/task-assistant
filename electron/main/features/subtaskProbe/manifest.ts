import type { FeatureModule, KernelDeps } from '../kernel/types'
import type { FeatureBus } from '../kernel/bus'
import { isFeatureEnabled } from '../../../../src/shared/kernel/types'

const MS_PER_DAY = 86_400_000

function todayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10)
}

export const subtaskProbeManifest: FeatureModule = {
  id: 'subtaskProbe',
  order: 20,
  hooks: {},
  onRegister(bus: FeatureBus, deps: KernelDeps) {
    bus.on('deviation.alert', (ctx) => {
      if (!isFeatureEnabled(ctx.flags, 'subtaskProbe')) return
      const task = ctx.task as { id: string; title: string }
      const stuckKey = `stuck_probe:${task.id}:deviation:${todayKey()}`
      if (!deps.shouldSendAlert(stuckKey, MS_PER_DAY)) return
      deps.sendNotification({
        type: 'stuck_probe_offer',
        data: { taskId: task.id, taskTitle: task.title, trigger: 'deviation' }
      })
    })
  }
}
