/** Custom app-file:// URLs for local screenshot paths in the renderer. */

export function toAppFileUrl(filePath: string): string {
  if (!filePath?.trim()) return ''
  const normalized = filePath.replace(/\\/g, '/')
  return `app-file://${encodeURI(normalized)}`
}

export function fromAppFileUrl(requestUrl: string): string {
  let pathPart = requestUrl.replace(/^app-file:/i, '')
  if (!pathPart.startsWith('/')) pathPart = `/${pathPart}`
  return decodeURI(pathPart)
}
