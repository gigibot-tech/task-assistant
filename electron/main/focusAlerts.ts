import { app, BrowserWindow, Tray } from 'electron'
import { showNativeNotification } from './nativeNotifications'

export interface DeviationAlertPayload {
  severity: 'low' | 'medium' | 'high'
  similarity: number
  onTask?: boolean
  suggestion: string
  currentActivity: string
  expectedTask: string
  taskId: string
  taskTitle: string
}

export function restoreMainWindow(win: BrowserWindow | null) {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
  if (process.platform === 'darwin') {
    app.dock?.show()
  }
}

export function isWindowInBackground(win: BrowserWindow | null): boolean {
  if (!win || win.isDestroyed()) return true
  return !win.isVisible() || win.isMinimized() || !win.isFocused()
}

export async function deliverDeviationAlert(
  win: BrowserWindow | null,
  tray: Tray | null,
  alert: DeviationAlertPayload,
  options?: { sendNative?: boolean; restoreWindow?: boolean }
) {
  const sendNative = options?.sendNative ?? true
  const inBackground = isWindowInBackground(win)
  const shouldRestore = options?.restoreWindow ?? alert.severity === 'high'

  const title =
    alert.onTask === false ? `Off task — ${alert.taskTitle}` : `Focus check — ${alert.taskTitle}`

  const body = `${Math.round(alert.similarity * 100)}% match · ${alert.suggestion}`.slice(0, 220)

  if (sendNative) {
    await showNativeNotification({
      title,
      body,
      subtitle: 'Task Assistant',
      silent: alert.severity === 'low' && !inBackground,
      onClick: () => restoreMainWindow(win)
    })
  }

  if (shouldRestore && inBackground) {
    restoreMainWindow(win)
  } else if (process.platform === 'darwin' && alert.severity !== 'low') {
    app.dock?.bounce('informational')
  }

  if (tray && !tray.isDestroyed()) {
    tray.setToolTip(
      alert.onTask === false
        ? `Task Assistant — Off task: ${alert.taskTitle}`
        : `Task Assistant — Monitoring`
    )
  }
}

export function updateTrayMonitoringLabel(tray: Tray | null, label: string) {
  if (tray && !tray.isDestroyed()) {
    tray.setToolTip(label)
  }
}

export async function deliverFocusReminder(taskTitle: string, message: string) {
  await showNativeNotification({
    title: `Focus — ${taskTitle}`,
    body: message.slice(0, 220),
    subtitle: 'Task Assistant'
  })
}
