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

export function reportFileName(
  projectName: string | null | undefined,
  reportNo: string | null | undefined,
  inspectionId: string
): string {
  const label = reportNo ? `Report ${reportNo}` : `Report ${inspectionId.slice(0, 8)}`
  const full = projectName ? `${projectName} - ${label}` : label
  return sanitise(full) || `Report ${inspectionId.slice(0, 8)}`
}
