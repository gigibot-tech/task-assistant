import { desktopCapturer, screen, systemPreferences, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

export type ScreenPermissionStatus = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unsupported'

export interface ScreenCaptureResult {
  imagePath: string
  timestamp: string
  displayId: number
}

export interface ScreenPermissionResult {
  status: ScreenPermissionStatus
  granted: boolean
  openedSettings: boolean
  message: string
}

export class ScreenPermissionError extends Error {
  status: ScreenPermissionStatus
  constructor(message: string, status: ScreenPermissionStatus) {
    super(message)
    this.name = 'ScreenPermissionError'
    this.status = status
  }
}

export function getScreenPermissionStatus(): ScreenPermissionStatus {
  if (process.platform !== 'darwin') {
    return 'unsupported'
  }
  try {
    return systemPreferences.getMediaAccessStatus('screen') as ScreenPermissionStatus
  } catch {
    return 'unsupported'
  }
}

function isThumbnailValid(thumbnail: Electron.NativeImage): boolean {
  if (thumbnail.isEmpty()) return false
  const { width, height } = thumbnail.getSize()
  return width > 10 && height > 10
}

/** Opens macOS System Settings → Privacy → Screen Recording */
export async function openScreenRecordingSettings(): Promise<boolean> {
  if (process.platform !== 'darwin') return false

  const urls = [
    'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
  ]

  for (const url of urls) {
    try {
      await shell.openExternal(url)
      return true
    } catch {
      /* try next URL scheme */
    }
  }
  return false
}

async function probeScreenCapture(): Promise<boolean> {
  try {
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width, height } = primaryDisplay.size
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.min(width, 320), height: Math.min(height, 320) },
      fetchWindowIcons: false
    })
    return sources.length > 0 && isThumbnailValid(sources[0].thumbnail)
  } catch {
    return false
  }
}

/** Real capture test — do not use alone to decide UI permission state (false positives on macOS). */
export async function verifyScreenCaptureWorks(): Promise<boolean> {
  return probeScreenCapture()
}

/**
 * macOS does NOT support systemPreferences.askForMediaAccess('screen').
 * Permission is requested by calling desktopCapturer.getSources(), or via System Settings.
 */
export async function requestScreenPermission(): Promise<ScreenPermissionResult> {
  const before = getScreenPermissionStatus()

  if (before === 'granted') {
    return {
      status: before,
      granted: true,
      openedSettings: false,
      message: 'Screen recording is already enabled.'
    }
  }

  if (process.platform !== 'darwin') {
    const ok = await probeScreenCapture()
    return {
      status: ok ? 'granted' : 'unsupported',
      granted: ok,
      openedSettings: false,
      message: ok ? 'Screen capture ready.' : 'Screen capture is not available on this platform.'
    }
  }

  // Attempt capture — on first use macOS shows the Screen Recording permission dialog
  await probeScreenCapture()

  const afterPrompt = getScreenPermissionStatus()
  if (afterPrompt === 'granted') {
    return {
      status: 'granted',
      granted: true,
      openedSettings: false,
      message: 'Screen recording enabled. You can start monitoring.'
    }
  }

  const afterProbe = afterPrompt

  // If still not granted, open System Settings (required when user previously denied)
  const openedSettings = await openScreenRecordingSettings()

  const finalStatus = getScreenPermissionStatus()
  const granted = finalStatus === 'granted'

  if (granted) {
    return {
      status: 'granted',
      granted: true,
      openedSettings,
      message: 'Screen recording enabled.'
    }
  }

  if (openedSettings) {
    return {
      status: afterProbe === 'denied' ? 'denied' : finalStatus,
      granted: false,
      openedSettings: true,
      message:
        'System Settings opened. Enable Screen Recording for Task Assistant (or Electron in dev), then click “I enabled it”.'
    }
  }

  return {
    status: afterProbe === 'denied' ? 'denied' : finalStatus,
    granted: false,
    openedSettings: false,
    message:
      'Open System Settings → Privacy & Security → Screen Recording and enable this app.'
  }
}

async function getScreenSource() {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.size

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
    fetchWindowIcons: false
  })

  if (sources.length === 0) {
    throw new ScreenPermissionError(
      'No screen sources available. Grant Screen Recording permission in System Settings.',
      getScreenPermissionStatus()
    )
  }

  const source = sources[0]
  if (!isThumbnailValid(source.thumbnail)) {
    const status = getScreenPermissionStatus()
    throw new ScreenPermissionError(
      status === 'denied'
        ? 'Screen Recording permission denied. Enable Task Assistant in System Settings → Privacy → Screen Recording.'
        : 'Screen capture returned empty image. Grant Screen Recording permission and choose "Always Allow".',
      status === 'denied' ? 'denied' : 'not-determined'
    )
  }

  return { source, primaryDisplay }
}

export async function captureScreen(): Promise<ScreenCaptureResult> {
  const { source, primaryDisplay } = await getScreenSource()
  const pngBuffer = source.thumbnail.toPNG()

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filename = `screen-${timestamp}.png`
  const screenshotsDir = path.join(app.getPath('userData'), 'screenshots')

  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true })
  }

  const imagePath = path.join(screenshotsDir, filename)
  fs.writeFileSync(imagePath, pngBuffer)

  return {
    imagePath,
    timestamp: new Date().toISOString(),
    displayId: primaryDisplay.id
  }
}

export async function captureScreenBase64(): Promise<string> {
  const { source } = await getScreenSource()
  return source.thumbnail.toPNG().toString('base64')
}

export function cleanupOldScreenshots(): void {
  try {
    const screenshotsDir = path.join(app.getPath('userData'), 'screenshots')

    if (!fs.existsSync(screenshotsDir)) {
      return
    }

    const files = fs.readdirSync(screenshotsDir)
      .filter((f) => f.endsWith('.png'))
      .map((f) => ({
        name: f,
        path: path.join(screenshotsDir, f),
        time: fs.statSync(path.join(screenshotsDir, f)).mtime.getTime()
      }))
      .sort((a, b) => b.time - a.time)

    if (files.length > 50) {
      files.slice(50).forEach((file) => {
        fs.unlinkSync(file.path)
      })
    }
  } catch (error) {
    console.error('Cleanup error:', error)
  }
}

export function getRecentScreenshots(limit: number = 10): ScreenCaptureResult[] {
  try {
    const screenshotsDir = path.join(app.getPath('userData'), 'screenshots')

    if (!fs.existsSync(screenshotsDir)) {
      return []
    }

    return fs
      .readdirSync(screenshotsDir)
      .filter((f) => f.endsWith('.png'))
      .map((f) => {
        const filePath = path.join(screenshotsDir, f)
        const stats = fs.statSync(filePath)
        return {
          imagePath: filePath,
          timestamp: stats.mtime.toISOString(),
          displayId: 0
        }
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit)
  } catch (error) {
    console.error('Get screenshots error:', error)
    return []
  }
}
