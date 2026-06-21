import fs from 'fs'
import { nativeImage } from 'electron'

export interface FocusCaptureRecord {
  imagePath: string
  capturedAt: string
  dHash: string
}

const HASH_W = 9
const HASH_H = 8
const MAX_HISTORY = 5

/** Difference hash — fast visual fingerprint for “same screen?” checks. */
export function computeScreenshotDHash(imagePath: string): string | null {
  try {
    if (!imagePath || !fs.existsSync(imagePath)) return null

    const img = nativeImage.createFromPath(imagePath)
    if (img.isEmpty()) return null

    const small = img.resize({ width: HASH_W, height: HASH_H, quality: 'good' })
    const bmp = small.toBitmap()
    const gray: number[] = []

    for (let y = 0; y < HASH_H; y++) {
      for (let x = 0; x < HASH_W; x++) {
        const i = (y * HASH_W + x) * 4
        gray.push((bmp[i] + bmp[i + 1] + bmp[i + 2]) / 3)
      }
    }

    let bits = ''
    for (let y = 0; y < HASH_H; y++) {
      for (let x = 0; x < HASH_W - 1; x++) {
        const left = gray[y * HASH_W + x]
        const right = gray[y * HASH_W + x + 1]
        bits += left > right ? '1' : '0'
      }
    }

    return bits
  } catch {
    return null
  }
}

export function hashSimilarity(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 0
  let same = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) same++
  }
  return same / a.length
}

export function analyzeCaptureHistory(
  history: Array<{ dHash?: string | null }>
): { averageSimilarity: number; pairCount: number; sampleCount: number; unchanged: boolean } {
  const valid = history.filter((entry) => entry.dHash)
  if (valid.length < 2) {
    return { averageSimilarity: 0, pairCount: 0, sampleCount: valid.length, unchanged: false }
  }

  let sum = 0
  for (let i = 1; i < valid.length; i++) {
    sum += hashSimilarity(valid[i - 1].dHash!, valid[i].dHash!)
  }

  const pairCount = valid.length - 1
  const averageSimilarity = sum / pairCount

  return {
    averageSimilarity,
    pairCount,
    sampleCount: valid.length,
    unchanged: averageSimilarity >= 0.9 && valid.length >= 3
  }
}

export function appendFocusCapture(
  history: FocusCaptureRecord[] | undefined,
  imagePath: string | undefined
): FocusCaptureRecord[] {
  if (!imagePath) return history ?? []

  const dHash = computeScreenshotDHash(imagePath)
  if (!dHash) return history ?? []

  const next: FocusCaptureRecord[] = [
    ...(history ?? []),
    { imagePath, capturedAt: new Date().toISOString(), dHash }
  ]

  return next.slice(-MAX_HISTORY)
}

export function unchangedScreenHint(
  history: FocusCaptureRecord[] | undefined
): { avgSimilarity: number; sampleCount: number } | null {
  const stats = analyzeCaptureHistory(history ?? [])
  if (stats.sampleCount < 2 || stats.averageSimilarity < 0.88) return null
  return { avgSimilarity: stats.averageSimilarity, sampleCount: stats.sampleCount }
}
