import { powerSaveBlocker } from 'electron'

let nextCheckTimeout: ReturnType<typeof setTimeout> | null = null
let checkInProgress = false
let powerBlockerId: number | null = null

export function isCheckInProgress(): boolean {
  return checkInProgress
}

export function setCheckInProgress(value: boolean) {
  checkInProgress = value
}

export function cancelScheduledCheck() {
  if (nextCheckTimeout) {
    clearTimeout(nextCheckTimeout)
    nextCheckTimeout = null
  }
}

export function enableBackgroundMonitoring() {
  if (powerBlockerId === null) {
    powerBlockerId = powerSaveBlocker.start('prevent-app-suspension')
  }
}

export function disableBackgroundMonitoring() {
  if (powerBlockerId !== null) {
    powerSaveBlocker.stop(powerBlockerId)
    powerBlockerId = null
  }
}

export function scheduleNextCheck(
  intervalMinutes: number,
  onFire: () => void
): number {
  cancelScheduledCheck()
  const ms = Math.max(intervalMinutes, 1) * 60 * 1000
  const nextAt = Date.now() + ms

  nextCheckTimeout = setTimeout(() => {
    nextCheckTimeout = null
    onFire()
  }, ms)

  return nextAt
}

export function scheduleCheckAt(timestamp: number, onFire: () => void) {
  cancelScheduledCheck()
  const delay = Math.max(0, timestamp - Date.now())

  nextCheckTimeout = setTimeout(() => {
    nextCheckTimeout = null
    onFire()
  }, delay)
}
