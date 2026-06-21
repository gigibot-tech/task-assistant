import { Notification, app, shell } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export interface NativeNotificationOptions {
  title: string
  body: string
  subtitle?: string
  silent?: boolean
  onClick?: () => void
}

/** Keep references so GC does not destroy notifications before display. */
const notificationRefs = new Map<string, Notification>()

let preferAppleScript =
  process.platform === 'darwin' &&
  (process.env.ELECTRON_RENDERER_URL != null || process.env.USE_APPLESCRIPT_NOTIFICATIONS === '1')

function notificationKey(options: NativeNotificationOptions): string {
  return `${options.title}:${options.body}:${Date.now()}`
}

async function showViaAppleScript(options: NativeNotificationOptions): Promise<boolean> {
  if (process.platform !== 'darwin') return false

  const title = options.title.slice(0, 120)
  const body = options.body.slice(0, 220)
  const subtitle = options.subtitle?.slice(0, 120)

  const script = subtitle
    ? `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)} subtitle ${JSON.stringify(subtitle)}`
    : `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`

  try {
    await execFileAsync('osascript', ['-e', script])
    console.log('[notifications] AppleScript → Notification Center:', title)
    return true
  } catch (err) {
    console.error('[notifications] AppleScript failed:', err)
    return false
  }
}

function showViaElectron(options: NativeNotificationOptions): boolean {
  if (!Notification.isSupported()) return false

  const key = notificationKey(options)
  const notification = new Notification({
    title: options.title.slice(0, 120),
    body: options.body.slice(0, 220),
    subtitle: options.subtitle?.slice(0, 120),
    silent: options.silent ?? false
  })

  notification.on('click', () => {
    options.onClick?.()
    notificationRefs.delete(key)
  })

  notification.on('close', () => {
    notificationRefs.delete(key)
  })

  notification.on('failed', () => {
    notificationRefs.delete(key)
    preferAppleScript = true
    void showViaAppleScript(options)
  })

  notificationRefs.set(key, notification)
  notification.show()
  return true
}

export async function showNativeNotification(options: NativeNotificationOptions): Promise<boolean> {
  if (process.platform === 'darwin') {
    app.setName('Task Assistant')
  }

  if (preferAppleScript) {
    return showViaAppleScript(options)
  }

  const shown = showViaElectron(options)
  if (shown) {
    console.log('[notifications] Electron API:', options.title)
    return true
  }

  return showViaAppleScript(options)
}

export async function openNotificationSettings(): Promise<boolean> {
  if (process.platform !== 'darwin') return false

  const urls = [
    'x-apple.systempreferences:com.apple.Notifications-Settings.extension',
    'x-apple.systempreferences:com.apple.preference.notifications'
  ]

  for (const url of urls) {
    try {
      await shell.openExternal(url)
      return true
    } catch {
      /* try next */
    }
  }
  return false
}

/** Dev / unsigned macOS builds use AppleScript → Notification Center (Electron API needs code signing). */
export async function initNativeNotifications(): Promise<void> {
  if (process.platform === 'darwin') {
    app.setName('Task Assistant')
  }

  if (process.env.ELECTRON_RENDERER_URL || process.env.USE_APPLESCRIPT_NOTIFICATIONS === '1') {
    preferAppleScript = true
  }
}
