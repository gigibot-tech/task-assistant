import { useCallback, useEffect, useState } from 'react'

export interface CaptureDisplayInfo {
  id: number
  label: string
  width: number
  height: number
  isPrimary: boolean
  thumbnailDataUrl: string
}

export interface CaptureDisplayState {
  displayId: number | null
  displayCount: number
  needsSelection: boolean
  label: string | null
}

interface MonitorPickerProps {
  compact?: boolean
  className?: string
}

export default function MonitorPicker({ compact = false, className = '' }: MonitorPickerProps) {
  const [displays, setDisplays] = useState<CaptureDisplayInfo[]>([])
  const [state, setState] = useState<CaptureDisplayState | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const [loading, setLoading] = useState(true)
  const [savedFlash, setSavedFlash] = useState(false)

  const refresh = useCallback(async () => {
    if (!window.electron?.listCaptureDisplays || !window.electron?.getCaptureDisplay) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [list, current] = await Promise.all([
        window.electron.listCaptureDisplays(),
        window.electron.getCaptureDisplay()
      ])
      setDisplays(list)
      setState(current)
      if (current.needsSelection) setShowPicker(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleSelect = async (id: number) => {
    if (!window.electron?.setCaptureDisplay) return
    const next = await window.electron.setCaptureDisplay(id)
    setState(next)
    setShowPicker(false)
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 2000)
  }

  if (loading || !state || state.displayCount <= 1) return null

  const pickerOpen = showPicker || state.needsSelection

  if (compact && !pickerOpen && state.displayId != null) {
    return (
      <div className={`flex items-center gap-2 text-xs text-gray-400 ${className}`}>
        <span className="whitespace-nowrap">Monitor: {state.label}</span>
        <button
          type="button"
          onClick={() => setShowPicker(true)}
          className="text-primary-400 hover:text-primary-300 underline"
        >
          Change
        </button>
        {savedFlash && <span className="text-green-400">Saved</span>}
      </div>
    )
  }

  if (compact && !pickerOpen) {
    return (
      <button
        type="button"
        onClick={() => setShowPicker(true)}
        className={`text-xs text-primary-400 hover:text-primary-300 underline ${className}`}
      >
        Choose monitor
      </button>
    )
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-gray-300">
          {state.needsSelection ? 'Choose screen to capture' : 'Screen capture monitor'}
        </p>
        {!state.needsSelection && compact && (
          <button
            type="button"
            onClick={() => setShowPicker(false)}
            className="text-[10px] text-gray-500 hover:text-gray-300"
          >
            Done
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2">
        {displays.map((display) => (
          <button
            key={display.id}
            type="button"
            onClick={() => void handleSelect(display.id)}
            className={`flex items-center gap-3 p-2 rounded-lg border text-left transition-colors ${
              state.displayId === display.id
                ? 'border-primary-500 bg-primary-900/30'
                : 'border-gray-600 bg-gray-800 hover:border-gray-500'
            }`}
          >
            <div className="w-24 h-14 rounded bg-gray-900 border border-gray-700 overflow-hidden flex-shrink-0">
              {display.thumbnailDataUrl ? (
                <img
                  src={display.thumbnailDataUrl}
                  alt={display.label}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-600">
                  No preview
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-100 truncate">{display.label}</div>
              <div className="text-[10px] text-gray-500">
                {display.width}×{display.height}
              </div>
            </div>
          </button>
        ))}
      </div>
      {savedFlash && <p className="text-xs text-green-400">Monitor selection saved.</p>}
    </div>
  )
}
