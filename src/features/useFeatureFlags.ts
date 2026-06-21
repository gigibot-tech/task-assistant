import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_FEATURE_FLAGS, mergeFeatureFlags, type FeatureFlags } from './types'

export function useFeatureFlags() {
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FEATURE_FLAGS)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      if (window.electron?.getFeatureFlags) {
        const next = await window.electron.getFeatureFlags()
        setFlags(mergeFeatureFlags(next))
      } else {
        const settings = await window.electron.getSettings()
        setFlags(mergeFeatureFlags(settings.featureFlags))
      }
    } catch {
      setFlags(DEFAULT_FEATURE_FLAGS)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { flags, loading, refresh }
}
