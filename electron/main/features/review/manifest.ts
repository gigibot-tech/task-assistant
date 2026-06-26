import type { FeatureModule } from '../kernel/types'

/** Worktree file review — indexing and schedule hooks reserved at order 45. */
export const reviewManifest: FeatureModule = {
  id: 'review',
  order: 45,
  alwaysOn: true,
  hooks: {}
}
