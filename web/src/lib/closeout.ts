/**
 * Close-out packs: the project's PS4 (producer statement, construction
 * review) on top of its site reports and registers — or, without a PS4,
 * just the reports and registers. Shared by the Close-out tab, Settings and
 * the /api/closeout routes. Set up with web/sql/closeout.sql.
 *
 * Phase 1 builds a DRAFT pack to download. Sending it to the PS4 author to
 * approve and sign comes later.
 */

/** What is read from the design PS1, by our own key. */
export const PS1_KEYS = [
  'clauses', 'owner', 'bca', 'respect', 'at', 'legal',
  'designFirm', 'designer', 'designerCpeng', 'ps1Date', 'cm', 'references',
] as const
export type Ps1Key = typeof PS1_KEYS[number]

/** Shown on the Close-out tab: the detail, and where it goes on the PS4. */
export const PS1_FIELD_INFO: Record<Ps1Key, { label: string; target: string; multiline?: boolean }> = {
  clauses:       { label: 'Building Code clause(s)',  target: 'Building Code clause(s), both places' },
  owner:         { label: 'To (owner / developer)',   target: 'To' },
  bca:           { label: 'To be supplied to',        target: 'To be supplied to' },
  respect:       { label: 'In respect of',            target: 'In respect of' },
  at:            { label: 'At',                       target: 'At' },
  legal:         { label: 'Legal description',        target: 'Legal description' },
  designFirm:    { label: 'Engineering design firm',  target: 'PS1(s) issued by' },
  designer:      { label: 'Design professional',      target: 'Schedule (page 2)' },
  designerCpeng: { label: 'Designer CPEng no.',       target: 'Schedule (page 2)' },
  ps1Date:       { label: 'PS1 date',                 target: 'Schedule (page 2)' },
  cm:            { label: 'Recommended monitoring',   target: 'Level of construction monitoring' },
  references:    { label: 'PS1 schedule',             target: 'Schedule (page 2)', multiline: true },
}

export type Ps1Reading = {
  path: string
  fileName: string
  uploadedAt: string
  /** 'form' when the values came out of the PS1's own fillable boxes —
   *  exact; 'ai' when Claude read a flattened or scanned PS1. */
  source: 'form' | 'ai'
  fields: Record<Ps1Key, string>
  legalNA: boolean
  /** Which details the engineer has checked. Every one must be before the
   *  PS4 can be sent. */
  checked: Partial<Record<Ps1Key, boolean>>
}

/** projects.closeout */
export type ProjectCloseout = {
  ps1?: Ps1Reading
  consentNo?: string
  amendmentNo?: string
  /** The project's default PS4 author (ps4_authors.id). */
  authorId?: string
}

/** firms.ps4_settings */
export type FirmPs4Settings = {
  formPath?: string
  formName?: string
  uploadedAt?: string
  /** What the form's fillable boxes check found. */
  fieldCheck?: { found: number; missing: string[] }
  /** The "is / is not a member of ACE New Zealand" choice on the PS4. */
  aceMember?: 'Is' | 'Is not'
  /** The firm's own Word layouts for pages SiteIQ otherwise draws. */
  templates?: Partial<Record<CloseoutTemplateKind, CloseoutTemplateInfo>>
}

export type Ps4Author = {
  id: string
  firm_id: string
  name: string
  email: string
  cpeng: string
  qualifications: string
  signature_path: string | null
  user_id: string | null
  active: boolean
  created_at?: string
}

/** Enough to go on a PS4: name, email, CPEng number, qualifications and a
 *  signature. */
export function authorComplete(a: Pick<Ps4Author, 'name' | 'email' | 'cpeng' | 'qualifications' | 'signature_path'>): boolean {
  return !!(a.name.trim() && a.email.trim() && a.cpeng.trim() && a.qualifications.trim() && a.signature_path)
}

export const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())

/** The PS4's fillable boxes, as named on the ACE NZ / Engineering NZ form
 *  (November 2021). Matched ignoring case. */
export const PS4_FIELDS = {
  clauses: 'Building code clauses',
  clauses2: 'Clauses',
  jobNo: 'Job_number',
  jobNoFooter: 'JobNumber',
  monitoringFirm: 'Construction monitoring firm',
  to: 'To',
  bca: 'To be supplied to',
  respect: 'In respect of',
  at: 'At',
  legal: 'Legal description',
  legalNA: 'CB1',
  designFirm: 'Engineering design firm',
  consentNo: 'Building consent no',
  amendmentNo: 'Consent amendment no',
  professional: 'Construction monitoring professional',
  cpeng: 'CPEng number',
  qualifications: 'Qualifications',
  date: 'Date',
  schedule: 'References',
  aceMember: 'Dropdown1',
  cmLevel: 'Dropdown2',
  signature: 'Signature',
} as const

export type PackMode = 'ps4' | 'reports'

export const PACK_SECTIONS = [
  { id: 'summary',   title: 'Construction monitoring summary', desc: 'Monitoring level, visits, dates, engineers and site notes' },
  { id: 'reportReg', title: 'Site report register',            desc: 'Every report: number, date, purpose, engineer' },
  { id: 'noteReg',   title: 'Site notes closed register',      desc: 'Every note, where it was raised, when and how it was closed' },
  { id: 'reports',   title: 'Site reports',                    desc: 'Each finalised report, in report order' },
] as const
export type PackSectionId = typeof PACK_SECTIONS[number]['id']

export type CompileRequest = {
  projectId: string
  mode: PackMode
  sections: PackSectionId[]
  /** Finalised reports to include; all of them when absent. */
  reportIds?: string[]
  authorId?: string
}

/** "CM 3" from whatever the PS1 says ("CM3", "cm 3", "3"). Empty if it
 *  isn't a level. */
export function normaliseCm(raw: string | null | undefined): string {
  const m = String(raw ?? '').match(/([1-5])/)
  return m && /cm|^\s*[1-5]\s*$/i.test(String(raw)) ? `CM ${m[1]}` : ''
}

// ── Firm templates for the pages SiteIQ draws ──────────────────────────────

/** Pages a firm can lay out itself, in Word. Without one, SiteIQ's own page
 *  is used. */
export const CLOSEOUT_TEMPLATE_KINDS = ['summary', 'noteReg'] as const
export type CloseoutTemplateKind = typeof CLOSEOUT_TEMPLATE_KINDS[number]

export type CloseoutTemplateInfo = {
  path: string
  name: string
  uploadedAt: string
  /** Placeholders in the file SiteIQ doesn't know (likely typos). */
  unknown: string[]
}

type Placeholder = { tag: string; desc: string }

/** What each template can use, in the {{…}} style of report templates.
 *  `loop` placeholders go inside the {{#loop}} … {{/loop}} table row. */
export const CLOSEOUT_PLACEHOLDERS: Record<CloseoutTemplateKind, { title: string; fields: Placeholder[]; loop: string; loopFields: Placeholder[] }> = {
  summary: {
    title: 'Construction monitoring summary',
    fields: [
      { tag: 'project_name', desc: 'Project name' },
      { tag: 'job_number', desc: 'Job number' },
      { tag: 'address', desc: 'Site address (from the PS1, else the project)' },
      { tag: 'client', desc: 'Owner / client' },
      { tag: 'consent_no', desc: 'Building consent number' },
      { tag: 'amendment_no', desc: 'Consent amendment number(s)' },
      { tag: 'council', desc: 'Building consent authority' },
      { tag: 'monitoring_level', desc: 'CM level, e.g. CM 3' },
      { tag: 'period_start', desc: 'First visit date' },
      { tag: 'period_end', desc: 'Last visit date' },
      { tag: 'visit_count', desc: 'Number of site reports' },
      { tag: 'engineers', desc: 'Engineers who visited' },
      { tag: 'inspected', desc: 'What was inspected, from the reports' },
      { tag: 'notes_raised', desc: 'Site notes raised' },
      { tag: 'notes_closed', desc: 'Site notes closed' },
      { tag: 'notes_open', desc: 'Site notes still open' },
      { tag: 'design_firm', desc: 'Engineering design firm (PS1)' },
      { tag: 'designer', desc: 'Design professional (PS1)' },
      { tag: 'ps1_date', desc: 'PS1 date' },
      { tag: 'ps4_author', desc: 'PS4 author' },
      { tag: 'ps4_author_cpeng', desc: 'PS4 author CPEng number' },
      { tag: 'firm_name', desc: 'Your firm' },
      { tag: 'date', desc: 'Date the pack was built' },
    ],
    loop: 'reports',
    loopFields: [
      { tag: 'report', desc: 'Report number, e.g. SR 002 — links to the report' },
      { tag: 'visit_date', desc: 'Visit date' },
      { tag: 'purpose', desc: 'Purpose of the visit' },
      { tag: 'engineer', desc: 'Engineer' },
    ],
  },
  noteReg: {
    title: 'Site notes closed register',
    fields: [
      { tag: 'project_name', desc: 'Project name' },
      { tag: 'job_number', desc: 'Job number' },
      { tag: 'notes_raised', desc: 'Site notes raised' },
      { tag: 'notes_closed', desc: 'Site notes closed' },
      { tag: 'notes_open', desc: 'Site notes still open' },
      { tag: 'firm_name', desc: 'Your firm' },
      { tag: 'date', desc: 'Date the pack was built' },
    ],
    loop: 'notes',
    loopFields: [
      { tag: 'ref', desc: 'Note number, e.g. SN 07' },
      { tag: 'location', desc: 'Location / item heading' },
      { tag: 'item', desc: 'First sentence of the note' },
      { tag: 'description', desc: 'The note in full' },
      { tag: 'raised_in', desc: 'Report and date it was raised in — links to the report' },
      { tag: 'status', desc: 'Open or Closed' },
      { tag: 'closed_date', desc: 'Date closed' },
      { tag: 'closed_by', desc: 'Who closed it' },
      { tag: 'how_closed', desc: 'The closing comment' },
    ],
  },
}
