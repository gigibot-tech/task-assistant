export const DEFAULT_OLLAMA_NUM_PREDICT = 1024
export const MIN_OLLAMA_NUM_PREDICT = 256
export const MAX_OLLAMA_NUM_PREDICT = 4096

/** Max output tokens for Ollama (num_predict). Raise if screen checks return empty responses. */
export function getOllamaNumPredict(
  settings?: Record<string, unknown> | null,
  kind: 'vision' | 'text' | 'compact' = 'vision'
): number {
  const raw =
    typeof settings?.ollamaNumPredict === 'number'
      ? settings.ollamaNumPredict
      : DEFAULT_OLLAMA_NUM_PREDICT

  const clamped = Math.min(
    MAX_OLLAMA_NUM_PREDICT,
    Math.max(MIN_OLLAMA_NUM_PREDICT, Math.round(raw))
  )

  if (kind === 'compact') return Math.min(clamped, 320)
  if (kind === 'text') return Math.min(clamped, 768)
  return clamped
}
