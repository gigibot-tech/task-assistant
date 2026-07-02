import { useState, useEffect } from 'react'
import { DEFAULT_BAND_MINUTES, THINKING_BAND_LABELS, type ThinkingBand } from '../lib/subtaskTypes'
import {
  DRIVE_ASPECTS,
  DRIVE_ASPECT_LABELS,
  DEFAULT_DRIVE_ENABLED_ASPECTS,
  type DriveAspect
} from '../lib/taskDrive'
import {
  DEFAULT_FEATURE_FLAGS,
  FEATURE_LABELS,
  mergeFeatureFlags,
  type FeatureFlags,
  type FeatureId
} from '../features/types'
import MonitorPicker from './MonitorPicker'

interface PomodoroSettings {
  enabled: boolean
  workMinutes: number
  breakMinutes: number
  longBreakMinutes: number
  cyclesBeforeLongBreak: number
  autoStartBreak: boolean
  autoStartWork: boolean
}

interface Settings {
  ollamaModel: string
  ollamaNumPredict: number
  deviationThreshold: number
  pollIntervalMinutes: number
  staleSensitivity: 'low' | 'medium' | 'high'
  pomodoro: PomodoroSettings
  estimate_calibration_factor?: number
  workplaceGuidanceEnabled?: boolean
  workplaceMaxListFiles?: number
  workplaceMaxReadBytes?: number
  workplaceMaxDepth?: number
  wastedBandMinutes?: Partial<Record<ThinkingBand, number>>
  recordOffTaskWasted?: boolean
  featureFlags?: FeatureFlags
  driveEnabledAspects?: DriveAspect[]
}

const defaultPomodoro = (): PomodoroSettings => ({
  enabled: true,
  workMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  cyclesBeforeLongBreak: 4,
  autoStartBreak: true,
  autoStartWork: true
})

export default function SettingsPanel({ onSettingsSaved }: { onSettingsSaved?: () => void }) {
  const [settings, setSettings] = useState<Settings>({
    ollamaModel: 'gemma4:latest',
    ollamaNumPredict: 1024,
    deviationThreshold: 0.7,
    pollIntervalMinutes: 5,
    staleSensitivity: 'medium',
    pomodoro: defaultPomodoro()
  })
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [notificationTest, setNotificationTest] = useState<'idle' | 'ok' | 'fail'>('idle')

  useEffect(() => {
    window.electron.getSettings().then((s) => {
      setSettings({
        ollamaModel: s.ollamaModel || 'gemma4:latest',
        ollamaNumPredict: s.ollamaNumPredict ?? 1024,
        deviationThreshold: s.deviationThreshold ?? 0.7,
        pollIntervalMinutes: s.pollIntervalMinutes ?? 5,
        staleSensitivity: s.staleSensitivity || 'medium',
        pomodoro: { ...defaultPomodoro(), ...(s.pomodoro || {}) },
        estimate_calibration_factor: s.estimate_calibration_factor,
        workplaceGuidanceEnabled: s.workplaceGuidanceEnabled !== false,
        workplaceMaxListFiles: s.workplaceMaxListFiles ?? 150,
        workplaceMaxReadBytes: s.workplaceMaxReadBytes ?? 24000,
        workplaceMaxDepth: s.workplaceMaxDepth ?? 4,
        wastedBandMinutes: {
          ...DEFAULT_BAND_MINUTES,
          ...(s.wastedBandMinutes || {})
        },
        recordOffTaskWasted: s.recordOffTaskWasted !== false,
        featureFlags: mergeFeatureFlags(s.featureFlags)
      })
      setLoading(false)
    })
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    await window.electron.updateSettings(settings)
    onSettingsSaved?.()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (loading) {
    return <div className="text-gray-400">Loading settings...</div>
  }

  return (
    <div className="max-w-xl">
      <h2 className="text-2xl font-bold mb-6">Settings</h2>
      <form onSubmit={handleSave} className="space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2">Ollama Model</label>
          <input
            type="text"
            value={settings.ollamaModel}
            onChange={(e) => setSettings({ ...settings, ollamaModel: e.target.value })}
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-primary-500"
            placeholder="gemma4:latest"
          />
          <p className="text-xs text-gray-500 mt-1">Default: gemma4:latest — run `ollama pull gemma4:latest`</p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Ollama max output tokens ({settings.ollamaNumPredict})
          </label>
          <input
            type="range"
            min={256}
            max={4096}
            step={128}
            value={settings.ollamaNumPredict}
            onChange={(e) =>
              setSettings({ ...settings, ollamaNumPredict: parseInt(e.target.value, 10) })
            }
            className="w-full"
          />
          <p className="text-xs text-gray-500 mt-1">
            Maps to Ollama <code className="text-gray-400">num_predict</code>. Increase (e.g. 1536–2048)
            if screen checks return empty responses — thinking models can burn tokens before JSON output.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Deviation Threshold ({Math.round(settings.deviationThreshold * 100)}% similarity)
          </label>
          <input
            type="range"
            min="0.3"
            max="0.9"
            step="0.05"
            value={settings.deviationThreshold}
            onChange={(e) =>
              setSettings({ ...settings, deviationThreshold: parseFloat(e.target.value) })
            }
            className="w-full"
          />
          <p className="text-xs text-gray-500 mt-1">Alert when similarity drops below this value</p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Deviation Poll Interval (minutes)</label>
          <select
            value={settings.pollIntervalMinutes}
            onChange={(e) =>
              setSettings({ ...settings, pollIntervalMinutes: parseInt(e.target.value) })
            }
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-primary-500"
          >
            <option value={1}>1 minute</option>
            <option value={5}>5 minutes</option>
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={60}>60 minutes</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Screen capture monitor</label>
          <MonitorPicker />
          <p className="text-xs text-gray-500 mt-1">
            Used for deviation checks, monitoring, and focus history. Shown only when multiple displays
            are connected.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Stale progress sensitivity</label>
          <select
            value={settings.staleSensitivity}
            onChange={(e) =>
              setSettings({
                ...settings,
                staleSensitivity: e.target.value as Settings['staleSensitivity']
              })
            }
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-primary-500"
          >
            <option value="low">Low — fewer nudges</option>
            <option value="medium">Medium — balanced</option>
            <option value="high">High — catch stale work sooner</option>
          </select>
        </div>

        {typeof settings.estimate_calibration_factor === 'number' && (
          <p className="text-sm text-gray-400">
            Estimate calibration factor: {settings.estimate_calibration_factor.toFixed(2)}×
            {' '}(learned from completed tasks — AI estimates are adjusted automatically)
          </p>
        )}

        <div className="pt-4 border-t border-gray-700 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Pomodoro</h3>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.pomodoro.enabled}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    pomodoro: { ...settings.pomodoro, enabled: e.target.checked }
                  })
                }
              />
              Enabled
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Work (min)</label>
              <input
                type="number"
                min={5}
                max={90}
                value={settings.pomodoro.workMinutes}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    pomodoro: { ...settings.pomodoro, workMinutes: parseInt(e.target.value) || 25 }
                  })
                }
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Break (min)</label>
              <input
                type="number"
                min={1}
                max={30}
                value={settings.pomodoro.breakMinutes}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    pomodoro: { ...settings.pomodoro, breakMinutes: parseInt(e.target.value) || 5 }
                  })
                }
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Long break (min)</label>
              <input
                type="number"
                min={5}
                max={60}
                value={settings.pomodoro.longBreakMinutes}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    pomodoro: {
                      ...settings.pomodoro,
                      longBreakMinutes: parseInt(e.target.value) || 15
                    }
                  })
                }
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Cycles before long</label>
              <input
                type="number"
                min={2}
                max={8}
                value={settings.pomodoro.cyclesBeforeLongBreak}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    pomodoro: {
                      ...settings.pomodoro,
                      cyclesBeforeLongBreak: parseInt(e.target.value) || 4
                    }
                  })
                }
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg"
              />
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-gray-700 space-y-4">
          <h3 className="text-lg font-semibold">Workplace context</h3>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.workplaceGuidanceEnabled !== false}
              onChange={(e) =>
                setSettings({ ...settings, workplaceGuidanceEnabled: e.target.checked })
              }
            />
            AI guidance on deviation (uses workplace folder + screenshots)
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Max files listed</label>
              <input
                type="number"
                min={50}
                max={500}
                value={settings.workplaceMaxListFiles ?? 150}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    workplaceMaxListFiles: parseInt(e.target.value) || 150
                  })
                }
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Max read bytes</label>
              <input
                type="number"
                min={8000}
                max={64000}
                step={1000}
                value={settings.workplaceMaxReadBytes ?? 24000}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    workplaceMaxReadBytes: parseInt(e.target.value) || 24000
                  })
                }
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Folder depth</label>
              <input
                type="number"
                min={2}
                max={8}
                value={settings.workplaceMaxDepth ?? 4}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    workplaceMaxDepth: parseInt(e.target.value) || 4
                  })
                }
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg"
              />
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-gray-700 space-y-3">
          <h3 className="text-lg font-semibold">Desktop sorter</h3>
          <p className="text-xs text-gray-500">
            Paths used by Desktop Sorter. You can also edit them in that view.
          </p>
          <p className="text-xs text-gray-500">
            Ollama threshold: use Desktop Sorter panel toggles; feature flag above enables the nav item.
          </p>
        </div>

        <div className="pt-4 border-t border-gray-700 space-y-4">
          <h3 className="text-lg font-semibold">Task drive</h3>
          <p className="text-xs text-gray-500">
            Which reflection aspects appear in Task Drive prompts and history.
          </p>
          <div className="space-y-2">
            {DRIVE_ASPECTS.map((aspect) => {
              const enabled = settings.driveEnabledAspects ?? DEFAULT_DRIVE_ENABLED_ASPECTS
              const checked = enabled.includes(aspect)
              return (
                <label key={aspect} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const current = settings.driveEnabledAspects ?? DEFAULT_DRIVE_ENABLED_ASPECTS
                      const next = e.target.checked
                        ? [...new Set([...current, aspect])]
                        : current.filter((a) => a !== aspect)
                      setSettings({
                        ...settings,
                        driveEnabledAspects:
                          next.length > 0 ? next : DEFAULT_DRIVE_ENABLED_ASPECTS
                      })
                    }}
                  />
                  <span className="text-gray-200">{DRIVE_ASPECT_LABELS[aspect]}</span>
                </label>
              )
            })}
          </div>
        </div>

        <div className="pt-4 border-t border-gray-700 space-y-4">
          <h3 className="text-lg font-semibold">Features</h3>
          <p className="text-xs text-gray-500">
            Toggle modular capabilities. Software phases requires a restart of panels after save.
          </p>
          <div className="space-y-3">
            {(Object.keys(FEATURE_LABELS) as FeatureId[]).map((id) => {
              const flags = settings.featureFlags ?? DEFAULT_FEATURE_FLAGS
              const disabled =
                (id === 'phaseGitSignals' || id === 'phaseBalanceAlerts') &&
                !flags.softwarePhases
              return (
                <label
                  key={id}
                  className={`flex items-start gap-2 text-sm ${disabled ? 'opacity-50' : ''}`}
                  title={FEATURE_LABELS[id].tooltip}
                >
                  <input
                    type="checkbox"
                    checked={flags[id]}
                    disabled={disabled}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        featureFlags: {
                          ...flags,
                          [id]: e.target.checked,
                          ...(id === 'softwarePhases' && !e.target.checked
                            ? { phaseGitSignals: false, phaseBalanceAlerts: false }
                            : {})
                        }
                      })
                    }
                    className="mt-1"
                  />
                  <span>
                    <span className="text-gray-200">{FEATURE_LABELS[id].label}</span>
                    <span className="block text-xs text-gray-500">{FEATURE_LABELS[id].tooltip}</span>
                  </span>
                </label>
              )
            })}
          </div>
        </div>

        <div className="pt-4 border-t border-gray-700 space-y-4">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold">Wasted time bands</h3>
            <span
              className="text-xs text-gray-500 cursor-help"
              title="Andrea Method: clarify by acting. Bands estimate thinking-without-coding time when you report being stuck."
            >
              ⓘ
            </span>
          </div>
          <p className="text-xs text-gray-500">
            Minutes credited per thinking band when you use the stuck probe. Aligns with the 30-minute
            code cap.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {(Object.keys(THINKING_BAND_LABELS) as ThinkingBand[]).map((band) => (
              <div key={band}>
                <label className="block text-xs text-gray-400 mb-1">
                  {THINKING_BAND_LABELS[band]}
                </label>
                <input
                  type="number"
                  min={1}
                  max={300}
                  value={settings.wastedBandMinutes?.[band] ?? DEFAULT_BAND_MINUTES[band]}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      wastedBandMinutes: {
                        ...settings.wastedBandMinutes,
                        [band]: parseInt(e.target.value, 10) || DEFAULT_BAND_MINUTES[band]
                      }
                    })
                  }
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg"
                />
              </div>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.recordOffTaskWasted !== false}
              onChange={(e) =>
                setSettings({ ...settings, recordOffTaskWasted: e.target.checked })
              }
            />
            Count small off-task focus checks toward wasted time (5 min each)
          </label>
        </div>

        <button
          type="submit"
          className="px-6 py-2 bg-primary-600 hover:bg-primary-700 rounded-lg font-medium transition-colors"
        >
          {saved ? 'Saved!' : 'Save Settings'}
        </button>
      </form>

      <div className="mt-10 pt-8 border-t border-gray-700">
        <h3 className="text-lg font-semibold mb-2">macOS Notifications</h3>
        <p className="text-sm text-gray-400 mb-4">
          Focus alerts appear in Notification Center when you are off task or the app is in the
          background. In dev mode, alerts use AppleScript (unsigned Electron builds cannot use the
          native API).
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={async () => {
              const result = await window.electron.testNativeNotification()
              setNotificationTest(result.ok ? 'ok' : 'fail')
              setTimeout(() => setNotificationTest('idle'), 3000)
            }}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
          >
            {notificationTest === 'ok'
              ? 'Sent!'
              : notificationTest === 'fail'
                ? 'Failed — check terminal'
                : 'Send test notification'}
          </button>
          <button
            type="button"
            onClick={() => window.electron.openNotificationSettings()}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
          >
            Open Notification Settings
          </button>
        </div>
      </div>
    </div>
  )
}
