import fs from 'fs'
import { nativeImage } from 'electron'

/** Max images per Ollama request — low single digit; screen checks use 1. */
export const MAX_OLLAMA_VISION_IMAGES = 2

/** Total base64 payload budget for all images in one request (~900KB). */
export const MAX_VISION_PAYLOAD_BYTES = 900_000

export const VISION_MAX_WIDTH = 1024
export const VISION_MAX_HEIGHT = 768
export const VISION_MIN_WIDTH = 640

export interface VisionBudgetInfo {
  maxWidth: number
  maxHeight: number
  estimatedBytesPerImage: number
  maxImagesInBudget: number
  twoImagesPossible: boolean
  totalPayloadBudgetBytes: number
}

interface PreparedVisionImage {
  base64: string
  width: number
  height: number
  payloadBytes: number
}

function base64PayloadBytes(base64: string): number {
  return Buffer.byteLength(base64, 'utf8')
}

function resizeToFit(image: Electron.NativeImage, maxWidth: number, maxHeight: number) {
  const { width, height } = image.getSize()
  if (width <= 0 || height <= 0) return image

  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  if (scale >= 1) return image

  return image.resize({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    quality: 'good'
  })
}

function encodePngWithinBudget(
  pngBuffer: Buffer,
  maxBytes: number
): PreparedVisionImage | null {
  let image = nativeImage.createFromBuffer(pngBuffer)
  if (image.isEmpty()) return null

  let maxW = VISION_MAX_WIDTH
  let maxH = VISION_MAX_HEIGHT

  for (let attempt = 0; attempt < 8; attempt++) {
    const resized = resizeToFit(image, maxW, maxH)
    const { width, height } = resized.getSize()
    const base64 = resized.toPNG().toString('base64')
    const payloadBytes = base64PayloadBytes(base64)

    if (payloadBytes <= maxBytes) {
      return { base64, width, height, payloadBytes }
    }

    maxW = Math.max(VISION_MIN_WIDTH, Math.round(maxW * 0.85))
    maxH = Math.max(1, Math.round(maxH * 0.85))
    image = resized
  }

  return null
}

function estimateMaxResolutionPngBytes(): number {
  return Math.round(VISION_MAX_WIDTH * VISION_MAX_HEIGHT * 0.55)
}

export function computeVisionBudget(): VisionBudgetInfo {
  const estimatedRaw = estimateMaxResolutionPngBytes()
  const estimatedBytesPerImage = Math.ceil((estimatedRaw * 4) / 3)
  const maxImagesInBudget = Math.min(
    MAX_OLLAMA_VISION_IMAGES,
    Math.max(1, Math.floor(MAX_VISION_PAYLOAD_BYTES / estimatedBytesPerImage))
  )

  return {
    maxWidth: VISION_MAX_WIDTH,
    maxHeight: VISION_MAX_HEIGHT,
    estimatedBytesPerImage,
    maxImagesInBudget,
    twoImagesPossible: maxImagesInBudget >= 2,
    totalPayloadBudgetBytes: MAX_VISION_PAYLOAD_BYTES
  }
}

export function prepareVisionBase64(
  pngBuffer: Buffer,
  maxBytes = Math.floor(MAX_VISION_PAYLOAD_BYTES / MAX_OLLAMA_VISION_IMAGES)
): string {
  const prepared = encodePngWithinBudget(pngBuffer, maxBytes)
  if (!prepared) {
    throw new Error('Failed to prepare screenshot within vision payload budget')
  }
  return prepared.base64
}

export interface VisionPayloadPlan {
  images: string[]
  totalPayloadBytes: number
  droppedReference: boolean
  droppedCount: number
  budget: VisionBudgetInfo
}

/** Prepare 1–2 images for Ollama — never sends capture history, only explicit inputs. */
export function planVisionPayload(input: {
  current: Buffer
  reference?: Buffer
  requestedMax?: number
}): VisionPayloadPlan {
  const budget = computeVisionBudget()
  const requestedMax = Math.min(
    MAX_OLLAMA_VISION_IMAGES,
    Math.max(1, input.requestedMax ?? budget.maxImagesInBudget)
  )
  const allowedCount = Math.min(requestedMax, budget.maxImagesInBudget)
  const perImageBudget = Math.floor(MAX_VISION_PAYLOAD_BYTES / allowedCount)

  const currentPrepared = encodePngWithinBudget(input.current, perImageBudget)
  if (!currentPrepared) {
    throw new Error('Current screenshot exceeds vision payload budget')
  }

  const images: string[] = []
  let droppedReference = false
  let droppedCount = 0

  if (input.reference && allowedCount >= 2 && budget.twoImagesPossible) {
    const refPrepared = encodePngWithinBudget(input.reference, perImageBudget)
    const combined = (refPrepared?.payloadBytes ?? 0) + currentPrepared.payloadBytes

    if (refPrepared && combined <= MAX_VISION_PAYLOAD_BYTES) {
      images.push(refPrepared.base64, currentPrepared.base64)
    } else {
      droppedReference = true
      droppedCount += 1
      images.push(currentPrepared.base64)
      console.warn(
        '[vision] reference image dropped — combined payload exceeds budget at',
        `${VISION_MAX_WIDTH}x${VISION_MAX_HEIGHT}`
      )
    }
  } else {
    if (input.reference && (!budget.twoImagesPossible || allowedCount < 2)) {
      droppedReference = true
      droppedCount += 1
      console.warn(
        '[vision] reference image skipped — budget allows',
        budget.maxImagesInBudget,
        'image(s) at current resolution'
      )
    }
    images.push(currentPrepared.base64)
  }

  const totalPayloadBytes = images.reduce((sum, b64) => sum + base64PayloadBytes(b64), 0)

  return { images, totalPayloadBytes, droppedReference, droppedCount, budget }
}

export function capOllamaVisionImages(images: string[]): string[] {
  const budget = computeVisionBudget()
  const maxCount = Math.min(MAX_OLLAMA_VISION_IMAGES, budget.maxImagesInBudget, images.length)
  const selected = images.slice(-maxCount)

  let total = selected.reduce((sum, b64) => sum + base64PayloadBytes(b64), 0)
  while (selected.length > 1 && total > MAX_VISION_PAYLOAD_BYTES) {
    selected.shift()
    total = selected.reduce((sum, b64) => sum + base64PayloadBytes(b64), 0)
  }

  if (selected.length < images.length) {
    console.warn(
      `[vision] capped Ollama images ${images.length} → ${selected.length} (budget ${budget.maxImagesInBudget} at ${VISION_MAX_WIDTH}x${VISION_MAX_HEIGHT})`
    )
  }

  return selected
}

export function logVisionPayloadStats(images: string[], context: string) {
  const budget = computeVisionBudget()
  const totalBytes = images.reduce((sum, b64) => sum + base64PayloadBytes(b64), 0)
  console.log(
    `[vision] ${context}: ${images.length} image(s), ${Math.round(totalBytes / 1024)}KB / ${Math.round(budget.totalPayloadBudgetBytes / 1024)}KB budget, max ${budget.maxImagesInBudget} at ${budget.maxWidth}x${budget.maxHeight}, two=${budget.twoImagesPossible}`
  )
}
