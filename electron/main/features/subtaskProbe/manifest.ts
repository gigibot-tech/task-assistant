import type { FeatureModule, KernelDeps } from '../kernel/types'
import type { FeatureBus } from '../kernel/bus'

/** Probe is opened manually from DeviationAlert or task panels — no auto modal on deviation. */
export const subtaskProbeManifest: FeatureModule = {
  id: 'subtaskProbe',
  order: 20,
  hooks: {},
  onRegister(_bus: FeatureBus, _deps: KernelDeps) {}
}
