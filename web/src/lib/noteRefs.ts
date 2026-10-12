/**
 * Site note numbers (SN 01, SN 02…): one running count across a project's
 * reports, the same Ref a note has in its report's blocks ({{ref}}).
 *
 * Reports in order — by report number, then visit date, then when created —
 * and each report's notes in the order its report lists them (by id, as the
 * report generator reads them), counted on from the reports before. Shared
 * by the report (lib/observationBlocks) and the Site Notes list
 * (lib/siteNotes) so the two never disagree. A note on no report has no
 * number.
 */

export type RefReport = { id: string; report_no?: string | null; date?: string | null; created_at?: string | null }

/** When a report's visit was: its visit date ("10 October 2026", as the app
 *  writes it), else when it was created. */
export function visitTime(r: RefReport): number {
  const visit = Date.parse(String(r.date ?? ''))
  if (Number.isFinite(visit)) return visit
  const created = Date.parse(String(r.created_at ?? ''))
  return Number.isFinite(created) ? created : Number.MAX_SAFE_INTEGER
}

/** Sort key: report number, then visit date, then when created. */
export function reportOrder(r: RefReport): [number, number, number] {
  const n = parseInt(String(r.report_no ?? '').replace(/\D/g, ''), 10)
  const created = Date.parse(String(r.created_at ?? ''))
  return [Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER, visitTime(r), Number.isFinite(created) ? created : 0]
}

export const compareReportOrder = (a: [number, number, number], b: [number, number, number]) =>
  a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

/** Each note's number, by note id. */
export function noteRefs(reports: RefReport[], notes: { id: string; inspection_id?: string | null }[]): Map<string, number> {
  const ordered = [...reports].sort((a, b) => compareReportOrder(reportOrder(a), reportOrder(b)))
  const byReport = new Map<string, string[]>()
  for (const n of notes) {
    if (!n.inspection_id) continue
    const list = byReport.get(n.inspection_id) ?? []
    list.push(n.id)
    byReport.set(n.inspection_id, list)
  }
  const refs = new Map<string, number>()
  let running = 0
  for (const report of ordered) {
    for (const id of (byReport.get(report.id) ?? []).sort()) refs.set(id, ++running)
  }
  return refs
}

/** "SN 07". */
export const noteRefLabel = (ref: number | null | undefined) => ref ? `SN ${String(ref).padStart(2, '0')}` : null
