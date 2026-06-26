/** Map persisted settings → UI state for the "Last screen check" panel (per task). */

export interface FocusMatchDisplay {
  similarity: number | null
  onTask: boolean | null
  note: string
  screenSimilarity: number | null
  checkedTaskId: string | null
}

export const EMPTY_FOCUS_MATCH: FocusMatchDisplay = {
  similarity: null,
  onTask: null,
  note: '',
  screenSimilarity: null,
  checkedTaskId: null
}

export interface FocusCheckDisplay {
  activity: string
  checkedAt: string | null
  match: FocusMatchDisplay
}

export function focusCheckFromSettings(
  settings: Record<string, unknown>,
  forTaskId?: string | null
): FocusCheckDisplay | null {
  const checkedTaskId =
    typeof settings.lastCheckedTaskId === 'string' ? settings.lastCheckedTaskId : null

  if (!checkedTaskId) return null
  if (forTaskId && checkedTaskId !== forTaskId) return null

  const similarity =
    typeof settings.lastSimilarity === 'number' ? settings.lastSimilarity : null
  const hasResult = similarity !== null || typeof settings.currentActivity === 'string'

  if (!hasResult) return null

  return {
    activity: typeof settings.currentActivity === 'string' ? settings.currentActivity : '',
    checkedAt:
      typeof settings.lastActivityDetectedAt === 'string'
        ? settings.lastActivityDetectedAt
        : null,
    match: {
      similarity,
      onTask: typeof settings.lastOnTask === 'boolean' ? settings.lastOnTask : null,
      note: typeof settings.lastFocusNote === 'string' ? settings.lastFocusNote : '',
      screenSimilarity:
        typeof settings.lastScreenCaptureSimilarity === 'number'
          ? settings.lastScreenCaptureSimilarity
          : null,
      checkedTaskId
    }
  }
}

export function focusCheckFromNotification(
  payload: Record<string, unknown>,
  forTaskId?: string | null
): FocusCheckDisplay | null {
  const taskId = typeof payload.taskId === 'string' ? payload.taskId : null
  if (!taskId) return null
  if (forTaskId && taskId !== forTaskId) return null

  const similarity = typeof payload.similarity === 'number' ? payload.similarity : null
  if (similarity === null && typeof payload.currentActivity !== 'string') return null

  return {
    activity: typeof payload.currentActivity === 'string' ? payload.currentActivity : '',
    checkedAt:
      typeof payload.checkedAt === 'string'
        ? payload.checkedAt
        : new Date().toISOString(),
    match: {
      similarity,
      onTask: typeof payload.onTask === 'boolean' ? payload.onTask : null,
      note: typeof payload.suggestion === 'string' ? payload.suggestion : '',
      screenSimilarity:
        typeof payload.screenCaptureSimilarity === 'number'
          ? payload.screenCaptureSimilarity
          : null,
      checkedTaskId: taskId
    }
  }
}
