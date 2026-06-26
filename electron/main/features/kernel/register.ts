import { createFeatureBus, type FeatureBus } from './bus'
import {
  runAfterPipeline,
  runPromptPipeline,
  runResultPipeline,
  sortedModules
} from './pipeline'
import { softwarePhasesManifest } from '../softwarePhases/manifest'
import { subtaskProbeManifest } from '../subtaskProbe/manifest'
import { workplaceManifest } from '../workplace/manifest'
import { semanticSorterManifest } from '../semanticSorter/manifest'
import { reviewManifest } from '../review/manifest'
import { smeManifest } from '../sme/manifest'
import type { FeatureModule, KernelDeps } from './types'

const MODULES = sortedModules([
  subtaskProbeManifest,
  smeManifest,
  softwarePhasesManifest,
  workplaceManifest,
  semanticSorterManifest,
  reviewManifest
])

let featureBus: FeatureBus | null = null
let registeredModules: FeatureModule[] = MODULES

export function initFeatureKernel(deps: KernelDeps): FeatureBus {
  featureBus = createFeatureBus()
  for (const mod of registeredModules) {
    mod.onRegister?.(featureBus, deps)
  }
  return featureBus
}

export function getFeatureBus(): FeatureBus {
  if (!featureBus) throw new Error('Feature kernel not initialized')
  return featureBus
}

export function getRegisteredModules(): FeatureModule[] {
  return registeredModules
}

export { runPromptPipeline, runResultPipeline, runAfterPipeline }
