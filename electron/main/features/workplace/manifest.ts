import type { FeatureModule } from '../kernel/types'

/** Workplace guidance hooks reserved at order 40; deviation recovery stays in index.ts for now. */
export const workplaceManifest: FeatureModule = {
  id: 'workplace',
  order: 40,
  alwaysOn: true,
  hooks: {}
}
