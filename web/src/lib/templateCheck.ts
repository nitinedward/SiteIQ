import AdmZip from 'adm-zip'

/**
 * What a firm can put in its Word template, and whether a given file uses it
 * correctly.
 *
 * The placeholders are fixed in code: anything else a firm types is printed
 * into the report as-is, which nobody notices until a client reads it. So an
 * uploaded template is checked and the firm told what was found, what looks
 * like a typo, and what's missing.
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
  { name: 'report_no', kind: 'data', description: 'Report number, e.g. 007' },
  { name: 'date', kind: 'data', description: 'Date of the visit' },
  { name: 'time', kind: 'data', description: 'Time the inspection was started, e.g. 14:00' },
  { name: 'engineer_name', kind: 'data', description: 'The engineer’s full name' },
  { name: 'engineer_user', kind: 'data', description: 'The engineer’s email name, for templates that write @yourfirm themselves' },
  { name: 'client_email', kind: 'data', description: 'The client’s email address, from the project' },
  { name: 'emailed_to_1', kind: 'data', description: 'The client’s name, from the project' },
  { name: 'emailed_to_2', kind: 'data', description: 'Second recipient — nothing fills this yet' },
  { name: 'site_contact', kind: 'data', description: 'Site contact, recorded when starting the inspection' },
  { name: 'contact_phone', kind: 'data', description: 'Site contact’s phone number' },
  { name: 'weather', kind: 'data', description: 'Weather, recorded when starting the inspection' },
  { name: 'drawings', kind: 'data', description: 'Drawing numbers chosen for the visit' },
]

const KNOWN = new Set(PLACEHOLDERS.map(p => p.name))
const AI_ONLY = new Set(PLACEHOLDERS.filter(p => p.kind === 'ai').map(p => p.name))

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

/** Text of each paragraph, with placeholders reunited if Word split them. */
function paragraphs(xml: string): string[] {
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(m =>
    [...m[0].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map(t => t[1]).join('')
  )
}

function placeholdersIn(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map(m => m[1])
}

/** Reads an uploaded .docx and reports how it will behave. */
export function checkTemplate(buffer: Buffer): TemplateCheck {
  const zip = new AdmZip(buffer)
  const read = (name: string) => zip.getEntry(name)?.getData().toString('utf-8') ?? ''

  const documentXml = read('word/document.xml')
  const headerFooterXml = zip.getEntries()
    .filter(e => /^word\/(header|footer)\d*\.xml$/.test(e.entryName))
    .map(e => e.getData().toString('utf-8'))

  const found = new Set<string>()
  const unknown = new Set<string>()
  const sharingParagraph = new Set<string>()
  const inHeaderFooter = new Set<string>()

  for (const para of paragraphs(documentXml)) {
    const names = placeholdersIn(para)
    for (const name of names) {
      ;(KNOWN.has(name) ? found : unknown).add(name)
      // An AI section replaces its whole paragraph, so anything else on that
      // line disappears with it.
      const rest = para.replace(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g, '').trim()
      if (AI_ONLY.has(name) && rest.length > 0) sharingParagraph.add(name)
    }
  }

  for (const xml of headerFooterXml) {
    for (const name of placeholdersIn(xml)) {
      ;(KNOWN.has(name) ? found : unknown).add(name)
      if (AI_ONLY.has(name)) inHeaderFooter.add(name)
    }
  }

  const missing = PLACEHOLDERS.map(p => p.name).filter(n => !found.has(n))
  const missingRequired = PLACEHOLDERS.filter(p => p.required && !found.has(p.name)).map(p => p.name)
  const contentControls = (documentXml.match(/<w:sdt[ >]/g) ?? []).length
    + headerFooterXml.reduce((n, xml) => n + (xml.match(/<w:sdt[ >]/g) ?? []).length, 0)

  return {
    found: [...found],
    unknown: [...unknown],
    missing,
    missingRequired,
    sharingParagraph: [...sharingParagraph],
    inHeaderFooter: [...inHeaderFooter],
    contentControls,
    ok: unknown.size === 0 && missingRequired.length === 0 && sharingParagraph.size === 0 && inHeaderFooter.size === 0,
  }
}
