export interface PomodoroSettings {
  enabled: boolean
  workMinutes: number
  breakMinutes: number
  longBreakMinutes: number
  cyclesBeforeLongBreak: number
  autoStartBreak: boolean
  autoStartWork: boolean
}

export interface PomodoroState {
  phase: 'idle' | 'work' | 'break' | 'long_break'
  cycleIndex: number
  phaseEndsAt: number | null
  taskId: string | null
}

export function defaultPomodoroSettings(): PomodoroSettings {
  return {
    enabled: true,
    workMinutes: 25,
    breakMinutes: 5,
    longBreakMinutes: 15,
    cyclesBeforeLongBreak: 4,
    autoStartBreak: true,
    autoStartWork: true
  }
}

type PhaseEndHandler = (event: {
  phase: 'work' | 'break' | 'long_break'
  nextPhase: 'break' | 'long_break' | 'work' | 'idle'
  taskId: string | null
  cycleIndex: number
}) => void | Promise<void>

let phaseTimeout: ReturnType<typeof setTimeout> | null = null
let state: PomodoroState = { phase: 'idle', cycleIndex: 0, phaseEndsAt: null, taskId: null }
let settings: PomodoroSettings = defaultPomodoroSettings()
let onPhaseEnd: PhaseEndHandler | null = null

function clearPhaseTimeout() {
  if (phaseTimeout) {
    clearTimeout(phaseTimeout)
    phaseTimeout = null
  }
}

function schedulePhaseEnd(ms: number, handler: () => void) {
  clearPhaseTimeout()
  phaseTimeout = setTimeout(() => {
    phaseTimeout = null
    void handler()
  }, Math.max(1000, ms))
}

export function configurePomodoro(nextSettings: Partial<PomodoroSettings>) {
  settings = { ...settings, ...nextSettings }
}

export function setPomodoroPhaseEndHandler(handler: PhaseEndHandler | null) {
  onPhaseEnd = handler
}

export function getPomodoroState(): PomodoroState {
  return { ...state }
}

export function getPomodoroSettings(): PomodoroSettings {
  return { ...settings }
}

export function stopPomodoro() {
  clearPhaseTimeout()
  state = { phase: 'idle', cycleIndex: 0, phaseEndsAt: null, taskId: null }
}

function startPhase(
  phase: PomodoroState['phase'],
  taskId: string | null,
  durationMinutes: number,
  cycleIndex: number
) {
  const phaseEndsAt = Date.now() + durationMinutes * 60 * 1000
  state = { phase, cycleIndex, phaseEndsAt, taskId }

  schedulePhaseEnd(durationMinutes * 60 * 1000, async () => {
    if (state.phase !== phase || state.taskId !== taskId) return

    if (phase === 'work') {
      const nextCycle = cycleIndex >= settings.cyclesBeforeLongBreak ? 1 : cycleIndex + 1
      const nextPhase =
        cycleIndex >= settings.cyclesBeforeLongBreak ? 'long_break' : 'break'

      await onPhaseEnd?.({
        phase: 'work',
        nextPhase,
        taskId,
        cycleIndex
      })

      if (!settings.autoStartBreak) {
        stopPomodoro()
        return
      }

      if (nextPhase === 'long_break') {
        startPhase('long_break', taskId, settings.longBreakMinutes, nextCycle)
      } else {
        startPhase('break', taskId, settings.breakMinutes, nextCycle)
      }
      return
    }

    if (phase === 'break' || phase === 'long_break') {
      await onPhaseEnd?.({
        phase,
        nextPhase: settings.autoStartWork ? 'work' : 'idle',
        taskId,
        cycleIndex
      })

      if (!settings.autoStartWork) {
        stopPomodoro()
        return
      }

      startPhase('work', taskId, settings.workMinutes, cycleIndex)
    }
  })
}

export function startPomodoroWork(taskId: string, pomodoroSettings?: Partial<PomodoroSettings>) {
  if (pomodoroSettings) configurePomodoro(pomodoroSettings)
  if (!settings.enabled) return

  clearPhaseTimeout()
  const cycleIndex = state.taskId === taskId ? state.cycleIndex || 1 : 1
  startPhase('work', taskId, settings.workMinutes, cycleIndex)
}

export function skipPomodoroPhase() {
  clearPhaseTimeout()
  if (state.phase === 'idle') return

  const { phase, taskId, cycleIndex } = state

  if (phase === 'work') {
    const nextPhase =
      cycleIndex >= settings.cyclesBeforeLongBreak ? 'long_break' : 'break'
    if (nextPhase === 'long_break') {
      startPhase('long_break', taskId, settings.longBreakMinutes, 1)
    } else {
      startPhase('break', taskId, settings.breakMinutes, cycleIndex)
    }
    return
  }

  if (taskId && settings.autoStartWork) {
    startPhase('work', taskId, settings.workMinutes, cycleIndex)
  } else {
    stopPomodoro()
  }
}
