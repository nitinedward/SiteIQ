/**
 * What a firm may put in its Word template, and the shape of the report a
 * checked template produces.
 *
 * Kept apart from lib/templateCheck so the Settings page can list the
 * placeholders without dragging the .docx reader — and its Node-only zip
 * library — into the browser bundle.
 */

export type PlaceholderKind = 'ai' | 'data'

export type PlaceholderDef = {
  name: string
  kind: PlaceholderKind
  description: string
  /** A report is not much use without these. */
  required?: boolean
}

export const PLACEHOLDERS: PlaceholderDef[] = [
  // Written by the AI. Each replaces the whole paragraph it sits in, so it
  // needs a line of its own.
  { name: 'purpose', kind: 'ai', description: 'Purpose of the inspection, one or two sentences', required: true },
  { name: 'findings', kind: 'ai', description: 'One bullet per site note, under the note’s own label', required: true },
  { name: 'recommendations', kind: 'ai', description: 'Contractor to provide — one item per note that asks for something' },
  { name: 'other_activity', kind: 'ai', description: 'Other activity on site — left blank for the engineer to fill in' },

  // Filled from the project, the inspection and the engineer.
  { name: 'project_name', kind: 'data', description: 'Project name' },
  { name: 'job_no', kind: 'data', description: 'Job number — the project’s number, e.g. PRJ-2024-001' },
  { name: 'report_no', kind: 'data', description: 'Report number, counted per project, e.g. 007' },
  { name: 'date', kind: 'data', description: 'Date of the visit' },
  { name: 'time', kind: 'data', description: 'Time the inspection was started, e.g. 14:00' },
  { name: 'engineer_name', kind: 'data', description: 'The engineer’s full name' },
  { name: 'engineer_user', kind: 'data', description: 'The engineer’s email name, for templates that write @yourfirm themselves' },
  { name: 'client_email', kind: 'data', description: 'The client’s email address, from the project' },
  { name: 'issued_to', kind: 'data', description: 'Everyone the report is issued to, by name — set on the project' },
  { name: 'issued_to_emails', kind: 'data', description: 'Their email addresses, in the same order' },
  { name: 'emailed_to_1', kind: 'data', description: 'The client’s name, from the project' },
  { name: 'emailed_to_2', kind: 'data', description: 'Second recipient — the rest of the issued-to list' },
  { name: 'site_contact', kind: 'data', description: 'Site contact, recorded when starting the inspection' },
  { name: 'contact_phone', kind: 'data', description: 'Site contact’s phone number' },
  { name: 'weather', kind: 'data', description: 'Weather, recorded when starting the inspection' },
  { name: 'drawings', kind: 'data', description: 'Drawing numbers chosen for the visit' },
]

export type TemplateCheck = {
  found: string[]
  /** Looks like a placeholder, but nothing fills it — printed as typed. */
  unknown: string[]
  /** Known placeholders the template doesn't use at all. */
  missing: string[]
  /** Required ones that are missing — the report would come out unusable. */
  missingRequired: string[]
  /** AI placeholders sitting in a paragraph with other words: the whole
   *  paragraph is replaced, so that text would be lost. */
  sharingParagraph: string[]
  /** AI placeholders in a header or footer, where only inline fields work. */
  inHeaderFooter: string[]
  /** Word content controls, date pickers and locked fields. Stripped from
   *  generated reports, so they're reported as a note, not a problem. */
  contentControls: number
  ok: boolean
}
