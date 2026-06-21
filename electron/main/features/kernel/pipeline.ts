import type { FeatureContext, FeatureFlags, FeatureId } from '../../../../src/shared/kernel/types'
import { isFeatureEnabled } from '../../../../src/shared/kernel/types'
import type { FeatureModule } from './types'

function isModuleEnabled(mod: FeatureModule, flags: FeatureFlags): boolean {
  if (mod.alwaysOn) return true
  return isFeatureEnabled(flags, mod.id as FeatureId)
}

export function runPromptPipeline(
  modules: FeatureModule[],
  hook: 'probe.prompt' | 'focus.prompt',
  ctx: FeatureContext
): string {
  const parts: string[] = []
  for (const mod of modules) {
    if (!isModuleEnabled(mod, ctx.flags)) continue
    const fn = mod.hooks?.[hook]
    if (!fn) continue
    const block = fn(ctx)
    if (block?.trim()) parts.push(block.trim())
  }
  return parts.length > 0 ? `\n${parts.join('\n')}\n` : ''
}

export function runResultPipeline<T>(
  modules: FeatureModule[],
  hook: 'probe.result' | 'focus.result',
  ctx: FeatureContext,
  initial: T
): T {
  let value = initial
  for (const mod of modules) {
    if (!isModuleEnabled(mod, ctx.flags)) continue
    const fn = mod.hooks?.[hook] as ((c: FeatureContext, r: T) => T) | undefined
    if (!fn) continue
    value = fn(ctx, value)
  }
  return value
}

export function runAfterPipeline(
  modules: FeatureModule[],
  hook: 'focus.after',
  ctx: FeatureContext
): void {
  for (const mod of modules) {
    if (!isModuleEnabled(mod, ctx.flags)) continue
    const fn = mod.hooks?.[hook]
    if (!fn) continue
    fn(ctx)
  }
}

export function sortedModules(modules: FeatureModule[]): FeatureModule[] {
  return [...modules].sort((a, b) => a.order - b.order)
}
