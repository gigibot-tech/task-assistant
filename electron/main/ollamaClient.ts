import axios from 'axios'

const OLLAMA_CHAT_URL = 'http://localhost:11434/api/chat'

export function stripModelNoise(raw: string): string {
  let text = raw.trim()
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  text = text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
  return text.trim()
}

function extractFieldsFromBrokenJson(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  const stringField = (key: string) => {
    const match = raw.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'i'))
    return match?.[1]?.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\')
  }

  const numberField = (key: string) => {
    const match = raw.match(new RegExp(`"${key}"\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)`, 'i'))
    return match ? parseFloat(match[1]) : undefined
  }

  const boolField = (key: string) => {
    const match = raw.match(new RegExp(`"${key}"\\s*:\\s*(true|false)`, 'i'))
    return match ? match[1].toLowerCase() === 'true' : undefined
  }

  out.activity = stringField('activity')
  out.label = stringField('label')
  out.explanation = stringField('explanation') ?? stringField('suggestion')
  out.summary = stringField('summary')
  out.tools_hint = stringField('tools_hint')
  out.similarity = numberField('similarity')
  out.onTask = boolField('onTask')

  return out
}

export function parseJsonResponse<T extends Record<string, unknown>>(raw: string): T {
  if (!raw?.trim()) {
    console.warn('[ollama] Empty response body')
    return {} as T
  }

  const cleaned = stripModelNoise(raw)
  const attempts: Array<() => unknown> = [
    () => JSON.parse(cleaned),
    () => {
      const once = JSON.parse(cleaned)
      if (typeof once === 'string') return JSON.parse(once)
      return once
    },
    () => {
      const match = cleaned.match(/\{[\s\S]*\}/)
      if (!match) throw new Error('No JSON object found')
      return JSON.parse(match[0])
    }
  ]

  for (const attempt of attempts) {
    try {
      const parsed = attempt()
      if (parsed && typeof parsed === 'object') {
        return parsed as T
      }
    } catch {
      /* try next */
    }
  }

  const extracted = extractFieldsFromBrokenJson(cleaned)
  if (Object.values(extracted).some((value) => value !== undefined)) {
    console.warn('[ollama] Used regex field extraction fallback')
    return extracted as T
  }

  console.warn('[ollama] Unparseable response (first 600 chars):', cleaned.slice(0, 600))
  return {} as T
}

export async function ollamaGenerate(
  model: string,
  prompt: string,
  images?: string[],
  options?: { numPredict?: number }
): Promise<string> {
  const message: Record<string, unknown> = { role: 'user', content: prompt }
  if (images?.length) {
    message.images = images
  }

  const body: Record<string, unknown> = {
    model,
    messages: [message],
    stream: false,
    format: 'json',
    options: { temperature: 0.2, num_predict: options?.numPredict ?? 512 }
  }

  let lastError: Error | null = null

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await axios.post(OLLAMA_CHAT_URL, body, { timeout: 120000 })
      const text = response.data?.message?.content ?? response.data?.response

      if (response.data?.error) {
        throw new Error(String(response.data.error))
      }
      if (typeof text !== 'string' || !text.trim()) {
        throw new Error('Empty Ollama response')
      }

      return text
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt === 0) {
        console.warn('[ollama] Request failed, retrying once:', lastError.message)
        await new Promise((resolve) => setTimeout(resolve, 1500))
      }
    }
  }

  throw lastError ?? new Error('Ollama request failed')
}
