import type {
  SmeAgreement,
  SmeValidationEntry,
  SmeWindowDays
} from '../types/smeValidation'

/** Domain / topic label derived from a task in the task list */
export function domainFromTask(task: { title: string; tags?: string[] }): string {
  const title = task.title.trim()
  const tags = (task.tags ?? []).map((t) => t.trim()).filter(Boolean)
  if (!title && tags.length) return tags.join(', ')
  if (!tags.length) return title
  return `${title} (${tags.join(', ')})`
}

const MS_PER_DAY = 86_400_000

export function filterSmeByWindow(
  entries: SmeValidationEntry[],
  windowDays: SmeWindowDays
): SmeValidationEntry[] {
  const cutoff = Date.now() - windowDays * MS_PER_DAY
  return entries
    .filter((e) => new Date(e.recorded_at).getTime() >= cutoff)
    .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime())
}

export function formatSmeTimelineLabel(entry: SmeValidationEntry): string {
  const agreement =
    entry.agreement === 'partial'
      ? 'Partial'
      : entry.agreement.charAt(0).toUpperCase() + entry.agreement.slice(1)
  const domain = entry.domain.trim() || 'General'
  const preview = entry.approach.trim().slice(0, 48)
  const suffix = entry.approach.length > 48 ? '…' : ''
  return `${agreement} · ${domain} · ${preview}${suffix}`
}

export function agreementColorClass(agreement: SmeAgreement): string {
  switch (agreement) {
    case 'agree':
      return 'bg-green-900/50 text-green-200 border-green-700'
    case 'disagree':
      return 'bg-red-900/50 text-red-200 border-red-700'
    case 'partial':
      return 'bg-yellow-900/50 text-yellow-200 border-yellow-700'
    default:
      return 'bg-gray-700 text-gray-300 border-gray-600'
  }
}

export function agreementIcon(agreement: SmeAgreement): string {
  switch (agreement) {
    case 'agree':
      return '✓'
    case 'disagree':
      return '✗'
    case 'partial':
      return '~'
    default:
      return '?'
  }
}

export function appendSmeValidation(
  entries: SmeValidationEntry[] | undefined,
  entry: SmeValidationEntry
): SmeValidationEntry[] {
  return [...(entries ?? []), entry]
}

export function normalizeAlignment(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value))
  if (!Number.isFinite(n)) return 0.5
  return Math.min(1, Math.max(0, n))
}

export function normalizeAgreement(
  value: unknown,
  alignment: number
): SmeAgreement {
  if (value === 'agree' || value === 'disagree' || value === 'partial') {
    return value
  }
  if (alignment >= 0.7) return 'agree'
  if (alignment >= 0.4) return 'partial'
  return 'disagree'
}
