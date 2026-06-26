import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  preloadVersion: 12,
  getTasks: () => ipcRenderer.invoke('get-tasks'),
  createTask: (task: any) => ipcRenderer.invoke('create-task', task),
  updateTask: (id: string, updates: any) => ipcRenderer.invoke('update-task', id, updates),
  deleteTask: (id: string) => ipcRenderer.invoke('delete-task', id),

  startTaskWork: (taskId: string) => ipcRenderer.invoke('start-task-work', taskId),
  pauseTaskWork: (taskId: string) => ipcRenderer.invoke('pause-task-work', taskId),
  resumeTaskWork: (taskId: string) => ipcRenderer.invoke('resume-task-work', taskId),
  completeTaskWork: (taskId: string) => ipcRenderer.invoke('complete-task-work', taskId),
  getTaskTimeStatus: (taskId: string) => ipcRenderer.invoke('get-task-time-status', taskId),
  getPomodoroStatus: () => ipcRenderer.invoke('get-pomodoro-status'),
  skipPomodoroPhase: () => ipcRenderer.invoke('skip-pomodoro-phase'),

  checkDeviationFromScreen: (taskId: string) =>
    ipcRenderer.invoke('check-deviation-from-screen', taskId),
  checkDeviation: (activity: string, task: string) =>
    ipcRenderer.invoke('check-deviation', activity, task),
  estimateTime: (task: any) => ipcRenderer.invoke('estimate-time', task),
  estimateSubtaskTime: (taskId: string, subtaskId: string) =>
    ipcRenderer.invoke('estimate-subtask-time', taskId, subtaskId),
  suggestCommunication: (text: string, context: string) =>
    ipcRenderer.invoke('suggest-communication', text, context),
  validateWithSME: (approach: string, domain: string) =>
    ipcRenderer.invoke('validate-sme', approach, domain),
  validateSmeForTask: (taskId: string, domain: string, approach: string) =>
    ipcRenderer.invoke('validate-sme-for-task', taskId, domain, approach),
  promoteSmeStepToSubtask: (taskId: string, entryId: string, stepIndex: number) =>
    ipcRenderer.invoke('promote-sme-step-to-subtask', taskId, entryId, stepIndex),

  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings: any) => ipcRenderer.invoke('update-settings', settings),
  checkOllamaHealth: () => ipcRenderer.invoke('check-ollama-health'),
  setSnooze: (minutes: number) => ipcRenderer.invoke('set-snooze', minutes),
  setActiveTask: (taskId: string | null) => ipcRenderer.invoke('set-active-task', taskId),
  setMonitoringInterval: (taskId: string | null, minutes: number | null) =>
    ipcRenderer.invoke('set-monitoring-interval', taskId, minutes),
  getMonitoringStatus: () => ipcRenderer.invoke('get-monitoring-status'),
  getScreenPermission: () => ipcRenderer.invoke('get-screen-permission'),
  verifyScreenCapture: () => ipcRenderer.invoke('verify-screen-capture'),
  requestScreenPermission: () => ipcRenderer.invoke('request-screen-permission'),
  openScreenSettings: () => ipcRenderer.invoke('open-screen-settings'),
  testNativeNotification: () => ipcRenderer.invoke('test-native-notification'),
  openNotificationSettings: () => ipcRenderer.invoke('open-notification-settings'),

  captureScreen: () => ipcRenderer.invoke('capture-screen'),
  captureScreenBase64: () => ipcRenderer.invoke('capture-screen-base64'),
  getRecentScreenshots: (limit?: number) => ipcRenderer.invoke('get-recent-screenshots', limit),
  cleanupScreenshots: () => ipcRenderer.invoke('cleanup-screenshots'),
  analyzeScreenshotForTask: (taskId: string, screenshotPath: string) =>
    ipcRenderer.invoke('analyze-screenshot-for-task', taskId, screenshotPath),

  pickWorkplaceFolder: () => ipcRenderer.invoke('pick-workplace-folder'),
  indexWorkplace: (taskId: string) => ipcRenderer.invoke('index-workplace', taskId),
  indexWorktreeFiles: (taskId: string) => ipcRenderer.invoke('index-worktree-files', taskId),
  generateReviewSchedule: (taskId: string, daysAvailable: number) =>
    ipcRenderer.invoke('generate-review-schedule', taskId, daysAvailable),
  allocateOfflineTime: (
    taskId: string,
    payload: { offlineStartIso: string; breakMinutes: number; workMinutes: number }
  ) => ipcRenderer.invoke('allocate-offline-time', taskId, payload),
  openWorkplacePath: (taskId: string, relativePath: string) =>
    ipcRenderer.invoke('open-workplace-path', taskId, relativePath),
  getWorkplaceGuidance: (taskId: string, forceRefresh?: boolean) =>
    ipcRenderer.invoke('get-workplace-guidance', taskId, forceRefresh),

  runSubtaskProbe: (
    taskId: string,
    opts?: { trigger?: string; userLine?: string; thinkingBand?: string }
  ) => ipcRenderer.invoke('run-subtask-probe', taskId, opts ?? {}),
  recordStuckEvent: (
    taskId: string,
    payload: {
      trigger: string
      thinking_band: string
      subtask_id?: string
      ai_challenge?: string
      ai_suggested_subtask?: string
    }
  ) => ipcRenderer.invoke('record-stuck-event', taskId, payload),
  setActiveSubtask: (taskId: string, subtaskId: string | null) =>
    ipcRenderer.invoke('set-active-subtask', taskId, subtaskId),

  getFeatureFlags: () => ipcRenderer.invoke('get-feature-flags'),
  setWorkPhase: (taskId: string, phase: string, source?: string) =>
    ipcRenderer.invoke('set-work-phase', taskId, phase, source ?? 'user'),
  syncPhaseGitSignals: (taskId: string) =>
    ipcRenderer.invoke('sync-phase-git-signals', taskId),

  semanticSorterDryRun: () => ipcRenderer.invoke('semantic-sorter-dry-run'),
  semanticSorterApply: (decisions: unknown[]) =>
    ipcRenderer.invoke('semantic-sorter-apply', decisions),
  semanticSorterSaveFeedback: (record: unknown) =>
    ipcRenderer.invoke('semantic-sorter-save-feedback', record),
  semanticSorterPickFolder: () => ipcRenderer.invoke('semantic-sorter-pick-folder'),
  semanticSorterGetSettings: () => ipcRenderer.invoke('semantic-sorter-get-settings'),
  semanticSorterUpdateSettings: (partial: unknown) =>
    ipcRenderer.invoke('semantic-sorter-update-settings', partial),

  onNotification: (callback: (data: any) => void) => {
    ipcRenderer.on('notification', (_, data) => callback(data))
  }
})

export interface DeviationScreenResult {
  similarity: number
  severity: 'low' | 'medium' | 'high'
  suggestion: string
  currentActivity: string
  activityLabel?: string
  imagePath?: string
  onTask: boolean
  expectedTask: string
}

export interface ElectronAPI {
  preloadVersion: number
  getTasks: () => Promise<any[]>
  createTask: (task: any) => Promise<any>
  updateTask: (id: string, updates: any) => Promise<any>
  deleteTask: (id: string) => Promise<{ success: boolean }>
  startTaskWork: (taskId: string) => Promise<any>
  pauseTaskWork: (taskId: string) => Promise<any>
  resumeTaskWork: (taskId: string) => Promise<any>
  completeTaskWork: (taskId: string) => Promise<any>
  getTaskTimeStatus: (taskId: string) => Promise<{
    taskId: string
    isRunning: boolean
    isPaused: boolean
    recordedSeconds: number
    liveSeconds: number
    breakSeconds: number
    pauseSeconds: number
    currentSessionStartedAt: string | null
    sessionCount: number
  } | null>
  getPomodoroStatus: () => Promise<{
    state: {
      phase: 'idle' | 'work' | 'break' | 'long_break'
      cycleIndex: number
      phaseEndsAt: number | null
      taskId: string | null
    }
    settings: {
      enabled: boolean
      workMinutes: number
      breakMinutes: number
      longBreakMinutes: number
      cyclesBeforeLongBreak: number
      autoStartBreak: boolean
      autoStartWork: boolean
    }
  }>
  skipPomodoroPhase: () => Promise<{
    phase: 'idle' | 'work' | 'break' | 'long_break'
    cycleIndex: number
    phaseEndsAt: number | null
    taskId: string | null
  }>
  checkDeviationFromScreen: (taskId: string) => Promise<DeviationScreenResult>
  checkDeviation: (activity: string, task: string) => Promise<DeviationScreenResult>
  estimateTime: (task: any) => Promise<{
    estimate: number
    confidence: number
    rawEstimate?: number
    calibrationFactor?: number
  }>
  estimateSubtaskTime: (
    taskId: string,
    subtaskId: string
  ) => Promise<{
    estimate: number
    confidence: number
    rawEstimate?: number
    calibrationFactor?: number
  }>
  suggestCommunication: (text: string, context: string) => Promise<{
    suggestions: string[]
    improvements: string[]
  }>
  validateWithSME: (approach: string, domain: string) => Promise<{
    alignment: number
    feedback: string
    agreement: 'agree' | 'disagree' | 'partial'
    reasoning: string
  }>
  validateSmeForTask: (
    taskId: string,
    domain: string,
    approach: string
  ) => Promise<{
    id: string
    recorded_at: string
    domain: string
    approach: string
    alignment: number
    agreement: 'agree' | 'disagree' | 'partial'
    feedback: string
    reasoning: string
    recommended_steps?: Array<{ title: string; rationale: string; priority?: string }>
    promoted_subtask_ids?: string[]
  }>
  promoteSmeStepToSubtask: (
    taskId: string,
    entryId: string,
    stepIndex: number
  ) => Promise<{ subtask: Record<string, unknown>; task: Record<string, unknown> }>
  getSettings: () => Promise<Record<string, any>>
  updateSettings: (settings: any) => Promise<{ success: boolean }>
  checkOllamaHealth: () => Promise<{ online: boolean; modelAvailable: boolean; model: string }>
  setSnooze: (minutes: number) => Promise<{ success: boolean; until: number }>
  setActiveTask: (taskId: string | null) => Promise<{ success: boolean }>
  setMonitoringInterval: (
    taskId: string | null,
    minutes: number | null
  ) => Promise<{ success: boolean; monitoring: boolean; intervalMinutes?: number; nextCheckAt?: number | null }>
  getMonitoringStatus: () => Promise<{
    monitoring: boolean
    intervalMinutes: number | null
    nextCheckAt: number | null
    checkInProgress: boolean
    snoozeUntil: number | null
    activeTaskId: string | null
  }>
  getScreenPermission: () => Promise<{ status: string }>
  verifyScreenCapture: () => Promise<{ status: string; captureWorks: boolean }>
  requestScreenPermission: () => Promise<{
    status: string
    granted: boolean
    openedSettings: boolean
    message: string
  }>
  openScreenSettings: () => Promise<{ opened: boolean; status: string }>
  testNativeNotification: () => Promise<{ ok: boolean }>
  openNotificationSettings: () => Promise<{ opened: boolean }>
  captureScreen: () => Promise<{ imagePath: string; timestamp: string; displayId: number }>
  captureScreenBase64: () => Promise<string>
  getRecentScreenshots: (limit?: number) => Promise<Array<{ imagePath: string; timestamp: string; displayId: number }>>
  cleanupScreenshots: () => Promise<{ success: boolean }>
  analyzeScreenshotForTask: (taskId: string, screenshotPath: string) => Promise<{
    timestamp: string
    imagePath: string
    aiPrediction: string
    activityLabel: string
    recommendation: string
    deviationScore: number
  }>
  pickWorkplaceFolder: () => Promise<{ path: string | null }>
  indexWorkplace: (taskId: string) => Promise<{
    indexed_at: string
    file_count: number
    tree_text: string
  }>
  indexWorktreeFiles: (taskId: string) => Promise<{
    files: Array<{ path: string; size: number; extension: string; lastModified?: string }>
    totalFiles: number
    indexedAt: string
    review_statuses?: Record<string, unknown>
    errors?: string[]
  }>
  generateReviewSchedule: (
    taskId: string,
    daysAvailable: number
  ) => Promise<{
    schedule: Record<string, unknown>
    review_statuses: Record<string, unknown>
  }>
  allocateOfflineTime: (
    taskId: string,
    payload: { offlineStartIso: string; breakMinutes: number; workMinutes: number }
  ) => Promise<Record<string, unknown>>
  openWorkplacePath: (
    taskId: string,
    relativePath: string
  ) => Promise<{ success: boolean; error?: string }>
  getWorkplaceGuidance: (
    taskId: string,
    forceRefresh?: boolean
  ) => Promise<{
    generated_at: string
    summary: string
    suggested_files: Array<{ path: string; reason: string }>
    suggested_actions: string[]
    tools_hint?: string
  } | null>
  runSubtaskProbe: (
    taskId: string,
    opts?: { trigger?: string; userLine?: string; thinkingBand?: string }
  ) => Promise<{
    challenge: string
    input: string
    output: string
    transformation: string
    smallest_slice: string
    suggested_subtask: {
      title: string
      input: string
      output: string
      transformation: string
      outcome: string
    }
    stupid_version_hint: string
    must_code_by: string
    build_one_now: string
    max_components: number
  }>
  recordStuckEvent: (
    taskId: string,
    payload: {
      trigger: string
      thinking_band: string
      subtask_id?: string
      ai_challenge?: string
      ai_suggested_subtask?: string
    }
  ) => Promise<{
    id: string
    recorded_at: string
    trigger: string
    thinking_band: string
    wasted_seconds_estimated: number
  }>
  setActiveSubtask: (taskId: string, subtaskId: string | null) => Promise<any>
  getFeatureFlags: () => Promise<Record<string, boolean>>
  setWorkPhase: (
    taskId: string,
    phase: string,
    source?: string
  ) => Promise<Record<string, unknown>>
  syncPhaseGitSignals: (taskId: string) => Promise<{
    suggested_phase: string
    confidence: number
    recent_commits_summary: string[]
    imbalance_score: number
    git_available: boolean
    phase_balance?: Record<string, unknown>
  }>
  semanticSorterDryRun: () => Promise<{
    decisions: Array<{
      source: string
      category: string
      confidence: number
      destination: string
      reason: string
      human_category: string
      human_reason: string
      semantic_tags: string[]
      matched_rules: string[]
      script_category?: string
      script_confidence?: number
      script_reason?: string
      augmented_by_ollama?: boolean
      destination_relative?: string
    }>
    summary: string
    csvPath: string | null
  }>
  semanticSorterApply: (
    decisions: Array<Record<string, unknown>>
  ) => Promise<{ moved: number; errors: Array<{ source: string; error: string }> }>
  semanticSorterSaveFeedback: (record: {
    created_at: string
    source: string
    source_name: string
    category: string
    destination: string
    tags: string[]
    note: string
  }) => Promise<{ success: boolean }>
  semanticSorterPickFolder: () => Promise<{ path: string | null }>
  semanticSorterGetSettings: () => Promise<Record<string, unknown>>
  semanticSorterUpdateSettings: (partial: Record<string, unknown>) => Promise<Record<string, unknown>>
  onNotification: (callback: (data: any) => void) => void
}

declare global {
  interface Window {
    electron: ElectronAPI
  }
}
