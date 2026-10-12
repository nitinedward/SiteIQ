/** Site note numbers (SN 01, SN 02…) — the same rule as the web's
 *  web/src/lib/noteRefs.ts, so a note has one number in its report, on the
 *  web and on the phone: reports by number, then visit date, then when
 *  created; each report's notes in id order, counted on from the reports
 *  before. A note on no report has no number. */

type RefReport = { id: string; report_no?: string | null; date?: string | null; created_at?: string | null }

function visitTime(r: RefReport): number {
  const visit = Date.parse(String(r.date ?? ''))
  if (Number.isFinite(visit)) return visit
  const created = Date.parse(String(r.created_at ?? ''))
  return Number.isFinite(created) ? created : Number.MAX_SAFE_INTEGER
}

function reportOrder(r: RefReport): [number, number, number] {
  const n = parseInt(String(r.report_no ?? '').replace(/\D/g, ''), 10)
  const created = Date.parse(String(r.created_at ?? ''))
  return [Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER, visitTime(r), Number.isFinite(created) ? created : 0]
}

/** Each note's number, by note id. */
export function noteRefs(reports: RefReport[], notes: { id: string; inspection_id?: string | null }[]): Map<string, number> {
  const ordered = [...reports].sort((a, b) => {
    const x = reportOrder(a), y = reportOrder(b)
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
  })
  const byReport = new Map<string, string[]>()
  for (const n of notes) {
    if (!n.inspection_id) continue
    byReport.set(n.inspection_id, [...(byReport.get(n.inspection_id) ?? []), n.id])
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
