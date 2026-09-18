/** Who a project's reports are issued to.
 *
 *  The same people receive every report on a project, and the list differs
 *  from project to project, so it's recorded once on the project
 *  (projects.report_recipients) instead of being retyped into each report.
 */

export type Recipient = { name: string; email: string }

/** Tolerant of the column arriving as jsonb, a JSON string, or nothing at all
 *  (a database where sql/project_report_recipients.sql hasn't been run). */
export function parseRecipients(raw: unknown): Recipient[] {
  const rows = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? (() => { try { return JSON.parse(raw || '[]') } catch { return [] } })()
      : []
  if (!Array.isArray(rows)) return []
  return rows
    .map((r: any) => ({ name: String(r?.name ?? '').trim(), email: String(r?.email ?? '').trim() }))
    .filter(r => r.name || r.email)
}

export function recipientNames(list: Recipient[]): string {
  return list.map(r => r.name || r.email).filter(Boolean).join(', ')
}

export function recipientEmails(list: Recipient[]): string {
  return list.map(r => r.email).filter(Boolean).join(', ')
}
