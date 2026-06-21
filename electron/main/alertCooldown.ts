const lastAlertAt = new Map<string, number>()

export function shouldSendAlert(
  key: string,
  cooldownMs: number,
  now = Date.now()
): boolean {
  const last = lastAlertAt.get(key) ?? 0
  if (now - last < cooldownMs) return false
  lastAlertAt.set(key, now)
  return true
}

export function clearAlertCooldown(key?: string) {
  if (key) {
    lastAlertAt.delete(key)
    return
  }
  lastAlertAt.clear()
}
