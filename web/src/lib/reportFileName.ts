/** Builds the human-facing file name for a report's downloads and for the
 *  frozen-PDF viewer. Shared by client and server so a report is called the
 *  same thing wherever it surfaces — previously the inline PDF viewer showed
 *  the raw storage object name (the inspection UUID). */

/** Strips characters Windows/macOS reject in file names, collapses runs of
 *  whitespace, and trims trailing dots/spaces (which Windows silently drops). */
function sanitise(name: string): string {
  return name
    .replace(/[\/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '')
    .trim()
}

/** What a report is called wherever it's listed — the report page header,
 *  the dashboard, the admin project view. A custom name set on the report
 *  wins; otherwise it falls back to the project name, which is what these
 *  lists showed before renaming existed. */
export function reportDisplayName(
  customName: string | null | undefined,
  projectName: string | null | undefined,
  fallback = '—'
): string {
  return customName?.trim() || projectName?.trim() || fallback
}

export function reportFileName(
  projectName: string | null | undefined,
  reportNo: string | null | undefined,
  inspectionId: string
): string {
  const label = reportNo ? `Report ${reportNo}` : `Report ${inspectionId.slice(0, 8)}`
  const full = projectName ? `${projectName} - ${label}` : label
  return sanitise(full) || `Report ${inspectionId.slice(0, 8)}`
}
