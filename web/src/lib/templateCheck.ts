import AdmZip from 'adm-zip'
import { PLACEHOLDERS, type TemplateCheck } from './templatePlaceholders'

/**
 * What a firm can put in its Word template, and whether a given file uses it
 * correctly.
 *
 * The placeholders are fixed in code: anything else a firm types is printed
 * into the report as-is, which nobody notices until a client reads it. So an
 * uploaded template is checked and the firm told what was found, what looks
 * like a typo, and what's missing.
 */

const KNOWN = new Set(PLACEHOLDERS.map(p => p.name))
const AI_ONLY = new Set(PLACEHOLDERS.filter(p => p.kind === 'ai').map(p => p.name))



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
