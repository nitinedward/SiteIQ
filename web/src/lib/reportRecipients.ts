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

// ── Emailed to ──────────────────────────────────────────────────────────────
// Who a report's "Emailed to" names ({{emailed_to}}): by default the site
// contact recorded on the phone when the visit started, or a person the
// project nominates instead (projects.emailed_to), and either can be
// overridden for one report (inspections.emailed_to). Names only.
// sql/emailed_to.sql adds both columns; before it runs, everything reads as
// "the site contact".

export type EmailedTo = { siteContact: true } | { name: string }

/** A stored choice, or null for none (the report follows its project; the
 *  project follows the site contact). */
export function parseEmailedTo(raw: unknown): EmailedTo | null {
  const v = typeof raw === 'string' ? (() => { try { return JSON.parse(raw) } catch { return null } })() : raw
  if (!v || typeof v !== 'object') return null
  if ((v as any).siteContact === true) return { siteContact: true }
  const name = String((v as any).name ?? '').trim()
  return name ? { name } : null
}

/** The name a report's "Emailed to" shows: the report's own choice, else
 *  the project's, else the visit's site contact. */
export function emailedToName(
  report: { emailed_to?: unknown; site_contact?: string | null },
  project: { emailed_to?: unknown } | null | undefined,
): string {
  const choice = parseEmailedTo(report.emailed_to) ?? parseEmailedTo(project?.emailed_to) ?? { siteContact: true }
  return 'name' in choice ? choice.name : String(report.site_contact ?? '').trim()
}
