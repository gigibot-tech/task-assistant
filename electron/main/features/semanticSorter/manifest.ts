import type { FeatureModule } from '../kernel/types'

/** Desktop semantic file sorter — IPC lives in semanticSorter module. */
export const semanticSorterManifest: FeatureModule = {
  id: 'semanticSorter',
  order: 45,
  hooks: {}
}
