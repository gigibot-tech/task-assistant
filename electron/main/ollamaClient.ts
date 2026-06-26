import axios from 'axios'
import { dialog, BrowserWindow, clipboard } from 'electron'
import { DEFAULT_OLLAMA_NUM_PREDICT } from './ollamaSettings'
import { capOllamaVisionImages, logVisionPayloadStats } from './visionPayload'

const OLLAMA_CHAT_URL = 'http://localhost:11434/api/chat'
const OLLAMA_GENERATE_URL = 'http://localhost:11434/api/generate'
const RAW_LOG_MAX_CHARS = 4000

let ollamaErrorDialogShown = false
let lastNotificationTime = 0
const NOTIFICATION_COOLDOWN = 30000 // 30 seconds

function notifyRendererOllamaError(model: string) {
  const now = Date.now()
  if (now - lastNotificationTime < NOTIFICATION_COOLDOWN) {
    console.log('[ollama] Notification cooldown active, skipping')
    return
  }
  
  lastNotificationTime = now
  console.log('[ollama] Sending Ollama error notification to renderer')
  
  const allWindows = BrowserWindow.getAllWindows()
  allWindows.forEach(window => {
    window.webContents.send('notification', {
      type: 'ollama-error',
      model,
      command: `ollama run ${model}`,
      timestamp: now
    })
  })
}

function showOllamaRestartDialog(model: string) {
  console.log('[ollama] showOllamaRestartDialog called, model:', model, 'dialogShown:', ollamaErrorDialogShown)
  
  // Always send notification to renderer for in-app banner
  notifyRendererOllamaError(model)
  
  if (ollamaErrorDialogShown) {
    console.log('[ollama] Dialog already shown, skipping')
    return // Prevent multiple dialogs
  }
  
  ollamaErrorDialogShown = true
  console.log('[ollama] Showing Ollama restart dialog')
  
  const command = `ollama run ${model}`
  
  try {
    // Get the focused window or any window
    const focusedWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    
    dialog.showMessageBox(focusedWindow || undefined as any, {
      type: 'warning',
      title: 'Ollama Connection Lost',
      message: 'Ollama stopped responding',
      detail: `Task Assistant needs Ollama to be running.\n\nPlease restart Ollama with:\n\n${command}\n\nClick "Copy Command" to copy it to your clipboard.`,
      buttons: ['Copy Command', 'Dismiss'],
      defaultId: 0,
      cancelId: 1
    }).then((result) => {
      console.log('[ollama] Dialog result:', result)
      if (result.response === 0) {
        clipboard.writeText(command)
        console.log('[ollama] Command copied to clipboard')
      }
      // Reset flag after 30 seconds to allow showing again if needed
      setTimeout(() => {
        ollamaErrorDialogShown = false
        console.log('[ollama] Dialog cooldown reset')
      }, 30000)
    }).catch((err) => {
      console.error('[ollama] Dialog error:', err)
      ollamaErrorDialogShown = false
    })
  } catch (err) {
    console.error('[ollama] Failed to show dialog:', err)
    ollamaErrorDialogShown = false
  }
}

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

function summarizeForLog(value: unknown, depth = 0): unknown {
  if (depth > 5) return '…'
  if (value == null) return value
  if (typeof value === 'string') {
    return value.length > 400 ? `${value.slice(0, 400)}…(${value.length} chars)` : value
  }
  if (Array.isArray(value)) {
    return value.map((item) => summarizeForLog(item, depth + 1))
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = summarizeForLog(nested, depth + 1)
    }
    return out
  }
  return value
}

function logOllamaRawResponse(
  label: string,
  data: unknown,
  meta?: Record<string, unknown>
) {
  const payload = { ...meta, raw: summarizeForLog(data) }
  const serialized = JSON.stringify(payload, null, 2)
  if (serialized.length > RAW_LOG_MAX_CHARS) {
    console.log(`[ollama] ${label} (truncated):`, serialized.slice(0, RAW_LOG_MAX_CHARS), '…')
  } else {
    console.log(`[ollama] ${label}:`, serialized)
  }
}

function stringFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (!part || typeof part !== 'object') return ''
      const record = part as Record<string, unknown>
      if (typeof record.text === 'string') return record.text
      if (typeof record.content === 'string') return record.content
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function extractOllamaText(data: unknown): { text: string; source: string } {
  if (!data) return { text: '', source: 'none' }
  if (typeof data === 'string') return { text: data, source: 'root-string' }
  if (typeof data !== 'object') return { text: '', source: 'none' }

  const obj = data as Record<string, unknown>
  const message = obj.message as Record<string, unknown> | undefined

  const contentText = stringFromContent(message?.content)
  if (contentText.trim()) return { text: contentText, source: 'message.content' }

  if (typeof obj.response === 'string' && obj.response.trim()) {
    return { text: obj.response, source: 'response' }
  }

  const thinkingText =
    stringFromContent(message?.thinking) ||
    (typeof message?.thinking === 'string' ? message.thinking : '')
  if (thinkingText.trim()) {
    return { text: thinkingText, source: 'message.thinking' }
  }

  const messages = obj.messages
  if (Array.isArray(messages)) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const entry = messages[i] as Record<string, unknown>
      if (entry?.role !== 'assistant') continue
      const assistantText = stringFromContent(entry.content)
      if (assistantText.trim()) return { text: assistantText, source: `messages[${i}].content` }
    }
  }

  return { text: '', source: 'none' }
}

function emptyResponseError(data: Record<string, unknown> | undefined, source: string): Error {
  const doneReason = data?.done_reason
  const evalCount = data?.eval_count
  const detail = [
    `extracted from: ${source}`,
    doneReason ? `done_reason=${String(doneReason)}` : null,
    evalCount != null ? `eval_count=${String(evalCount)}` : null,
    data?.error ? `error=${String(data.error)}` : null
  ]
    .filter(Boolean)
    .join(', ')

  if (doneReason === 'length') {
    return new Error(`Empty Ollama response (token limit hit before output; ${detail})`)
  }
  return new Error(`Empty Ollama response (${detail})`)
}

async function ollamaGenerateViaChat(
  body: Record<string, unknown>
): Promise<{ text: string; raw: Record<string, unknown> }> {
  const response = await axios.post(OLLAMA_CHAT_URL, body, { timeout: 120000 })
  const raw =
    response.data && typeof response.data === 'object'
      ? (response.data as Record<string, unknown>)
      : { value: response.data }

  const firstMessage = (body.messages as Record<string, unknown>[] | undefined)?.[0]
  logOllamaRawResponse('chat raw response', raw, {
    endpoint: '/api/chat',
    model: body.model,
    hasImages: Boolean(firstMessage?.images)
  })

  if (raw.error) {
    throw new Error(String(raw.error))
  }

  const { text, source } = extractOllamaText(raw)
  if (!text.trim()) {
    throw emptyResponseError(raw, source)
  }

  console.log(`[ollama] extracted text from ${source} (${text.length} chars)`)
  return { text, raw }
}

async function ollamaGenerateViaGenerate(
  model: string,
  prompt: string,
  images?: string[],
  numPredict?: number
): Promise<{ text: string; raw: Record<string, unknown> }> {
  const body: Record<string, unknown> = {
    model,
    prompt,
    stream: false,
    think: false,
    format: 'json',
    options: { temperature: 0.2, num_predict: numPredict ?? 768 }
  }
  if (images?.length) body.images = images

  const response = await axios.post(OLLAMA_GENERATE_URL, body, { timeout: 120000 })
  const raw =
    response.data && typeof response.data === 'object'
      ? (response.data as Record<string, unknown>)
      : { value: response.data }

  logOllamaRawResponse('generate raw response (fallback)', raw, {
    endpoint: '/api/generate',
    model,
    hasImages: Boolean(images?.length)
  })

  if (raw.error) {
    throw new Error(String(raw.error))
  }

  const { text, source } = extractOllamaText(raw)
  if (!text.trim()) {
    throw emptyResponseError(raw, source)
  }

  console.log(`[ollama] extracted text from ${source} via /api/generate (${text.length} chars)`)
  return { text, raw }
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
  options?: { numPredict?: number; showErrorDialog?: boolean }
): Promise<string> {
  const message: Record<string, unknown> = { role: 'user', content: prompt }
  const cappedImages = images?.length ? capOllamaVisionImages(images) : undefined
  if (cappedImages?.length) {
    message.images = cappedImages
    logVisionPayloadStats(cappedImages, 'ollamaGenerate')
  }

  let lastError: Error | null = null
  const hasImages = Boolean(cappedImages?.length)
  const numPredict = options?.numPredict ?? DEFAULT_OLLAMA_NUM_PREDICT

  const chatBody: Record<string, unknown> = {
    model,
    messages: [message],
    stream: false,
    think: false,
    format: 'json',
    options: { temperature: 0.2, num_predict: numPredict }
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { text } = await ollamaGenerateViaChat(chatBody)
      return text
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      console.warn('[ollama] /api/chat failed:', lastError.message)

      if (hasImages && attempt === 0) {
        try {
          console.warn('[ollama] retrying via /api/generate fallback')
          const { text } = await ollamaGenerateViaGenerate(model, prompt, cappedImages, numPredict)
          return text
        } catch (fallbackErr) {
          lastError =
            fallbackErr instanceof Error ? fallbackErr : new Error(String(fallbackErr))
          console.warn('[ollama] /api/generate fallback failed:', lastError.message)
        }
      }

      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1500))
      }
    }
  }

  // Show error dialog if requested (default true for user-initiated actions)
  console.log('[ollama] Error occurred, showErrorDialog:', options?.showErrorDialog, 'model:', model)
  if (options?.showErrorDialog !== false) {
    console.log('[ollama] Calling showOllamaRestartDialog')
    showOllamaRestartDialog(model)
  } else {
    console.log('[ollama] Skipping dialog (showErrorDialog=false)')
  }
  
  throw lastError ?? new Error('Ollama request failed')
}
