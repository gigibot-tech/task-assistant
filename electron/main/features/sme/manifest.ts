import type { FeatureModule } from '../kernel/types'

export const smeManifest: FeatureModule = {
  id: 'smeValidator',
  order: 18,
  alwaysOn: true,
  hooks: {}
}
