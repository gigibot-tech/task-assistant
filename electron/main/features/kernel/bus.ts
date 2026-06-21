import type { DomainEvent, FeatureContext } from '../../../../src/shared/kernel/types'

export type BusHandler = (ctx: FeatureContext) => void

export interface FeatureBus {
  on(event: DomainEvent, handler: BusHandler): void
  emit(event: DomainEvent, ctx: FeatureContext): void
}

export function createFeatureBus(): FeatureBus {
  const handlers = new Map<DomainEvent, BusHandler[]>()

  return {
    on(event, handler) {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
    },
    emit(event, ctx) {
      const list = handlers.get(event) ?? []
      for (const handler of list) {
        try {
          handler(ctx)
        } catch (err) {
          console.error(`[featureBus] ${event} handler failed:`, err)
        }
      }
    }
  }
}
