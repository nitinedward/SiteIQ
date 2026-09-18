/** Drawings sharing a number are revisions of the same sheet.
 *
 *  Each upload is its own row and its own file — nothing is overwritten — so
 *  a sheet re-issued at Rev B leaves Rev A in place. Browsing shows only the
 *  latest revision of each sheet, matching the web admin portal; the older
 *  ones stay reachable rather than cluttering the list, and an engineer
 *  can't mark up a superseded sheet without choosing it deliberately.
 */

export type RevisionedDrawing = {
  id: string
  number?: string | null
  revision?: string | null
  created_at?: string | null
}

/** Newest upload first, which is the order revisions are read in. */
function newestFirst<T extends RevisionedDrawing>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const at = a.created_at ? new Date(a.created_at).getTime() : 0
    const bt = b.created_at ? new Date(b.created_at).getTime() : 0
    return bt - at
  })
}

function sheetKey(d: RevisionedDrawing): string {
  return (d.number ?? '').trim()
}

/** The latest revision of every sheet, keeping the caller's ordering.
 *  A drawing with no number can't be grouped, so it's always kept. */
export function latestRevisions<T extends RevisionedDrawing>(rows: T[]): T[] {
  const latestId = new Set<string>()
  const seen = new Set<string>()
  for (const d of newestFirst(rows)) {
    const key = sheetKey(d)
    if (!key) { latestId.add(d.id); continue }
    if (seen.has(key)) continue
    seen.add(key)
    latestId.add(d.id)
  }
  return rows.filter(d => latestId.has(d.id))
}

/** Every revision of one sheet, newest first. */
export function revisionsOf<T extends RevisionedDrawing>(rows: T[], drawing: T): T[] {
  const key = sheetKey(drawing)
  if (!key) return [drawing]
  return newestFirst(rows.filter(d => sheetKey(d) === key))
}

/** How many revisions a sheet has, for the "· 3 revisions" hint. */
export function revisionCount(rows: RevisionedDrawing[], drawing: RevisionedDrawing): number {
  const key = sheetKey(drawing)
  if (!key) return 1
  return rows.filter(d => sheetKey(d) === key).length
}
