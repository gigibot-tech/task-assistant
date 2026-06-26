export const OLLAMA_SHORT_BACKOFF_MS = 5 * 60 * 1000
export const OLLAMA_LONG_BACKOFF_MS = 15 * 60 * 1000
export const OLLAMA_FAILURES_FOR_LONG = 3

export function isOllamaFailureMessage(message: string): boolean {
  return /ollama|empty ollama|ECONNREFUSED|ENOTFOUND|timeout|socket hang up|not loaded|not available/i.test(
    message
  )
}

export function isOllamaFailure(error: unknown): boolean {
  return isOllamaFailureMessage(error instanceof Error ? error.message : String(error))
}

export function isOllamaPaused(settings: Record<string, unknown> | undefined): boolean {
  const until = settings?.ollamaPausedUntil
  return typeof until === 'number' && until > Date.now()
}

export function recordOllamaFailure(
  settings: Record<string, unknown>,
  error: Error
): Record<string, unknown> {
  const count =
    (typeof settings.ollamaFailureCount === 'number' ? settings.ollamaFailureCount : 0) + 1
  const backoffMs =
    count >= OLLAMA_FAILURES_FOR_LONG ? OLLAMA_LONG_BACKOFF_MS : OLLAMA_SHORT_BACKOFF_MS
  return {
    ...settings,
    ollamaFailureCount: count,
    ollamaLastError: error.message,
    ollamaLastErrorAt: new Date().toISOString(),
    ollamaPausedUntil: Date.now() + backoffMs
  }
}

export function clearOllamaFailure(settings: Record<string, unknown>): Record<string, unknown> {
  const next = { ...settings }
  delete next.ollamaFailureCount
  delete next.ollamaLastError
  delete next.ollamaLastErrorAt
  delete next.ollamaPausedUntil
  return next
}
