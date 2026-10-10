import AdmZip from 'adm-zip'
import { PLACEHOLDERS, type TemplateCheck, type TemplateIssue } from './templatePlaceholders'

/**
 * What a firm can put in its Word template, and whether a given file uses it
 * correctly.
 *
 * The placeholders are fixed in code: anything else a firm types is printed
 * into the report as-is, which nobody notices until a client reads it. So an
 * uploaded template is checked and the firm told what was found, what looks
 * like a typo, and what's missing — and anything in the file that report
 * generation would trip over.
 *
 * Read-only: this inspects a template and reports. It changes nothing, and
 * nothing it finds stops a template being used.
 */

const KNOWN = new Set(PLACEHOLDERS.map(p => p.name))
const AI_ONLY = new Set(PLACEHOLDERS.filter(p => p.kind === 'ai').map(p => p.name))

/** The headers and footers report generation fills in (lib/templateProcessor,
 *  fillTemplate). Placeholders in any other are left as typed. */
const FILLED_HEADERS_FOOTERS = new Set(['word/header1.xml', 'word/header2.xml', 'word/footer1.xml'])

/** SiteIQ's photo table is 9160 twips (16.2 cm) wide (lib/appendAttachments). */
const PHOTO_TABLE_TWIPS = 9160

type Para = { text: string; xml: string }

/** Each paragraph's text (placeholders Word split across runs reunited) and
 *  its XML. */
function paragraphs(xml: string): Para[] {
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(m => ({
    xml: m[0],
    text: [...m[0].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map(t => t[1]).join(''),
  }))
}

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

/** Placeholders as report generation sees them: {{name}} with letters,
 *  digits and underscores. */
function placeholdersIn(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map(m => m[1])
}

/** The words around position `at`, to find it in Word. */
function around(text: string, at: number, length: number): string {
  const from = Math.max(0, at - 35)
  const to = Math.min(text.length, at + length + 35)
  return `${from > 0 ? '…' : ''}${decode(text.slice(from, to)).replace(/\s+/g, ' ').trim()}${to < text.length ? '…' : ''}`
}

/** Edit distance, for "did you mean". */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return d[a.length][b.length]
}

/** The real placeholder an unknown one was probably meant to be. */
function suggestionFor(name: string): string | null {
  const plain = name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
  let best: string | null = null
  let bestScore = Infinity
  for (const known of KNOWN) {
    const score = distance(plain, known)
    if (score < bestScore) { best = known; bestScore = score }
  }
  // One slip for a short name (finding → findings), two for a long one —
  // looser than that and "title" becomes "time".
  return best && bestScore <= (best.length <= 8 ? 1 : 2) ? best : null
}

/** Reads an uploaded .docx and reports how it will behave. */
export function checkTemplate(buffer: Buffer): TemplateCheck {
  const zip = new AdmZip(buffer)
  const read = (name: string) => zip.getEntry(name)?.getData().toString('utf-8') ?? ''

  const documentXml = read('word/document.xml')
  const headerFooters = zip.getEntries()
    .filter(e => /^word\/(header|footer)\d*\.xml$/.test(e.entryName))
    .map(e => ({ name: e.entryName, xml: e.getData().toString('utf-8') }))

  const issues: TemplateIssue[] = []
  const found = new Set<string>()
  const unknown = new Set<string>()
  const sharingParagraph = new Set<string>()
  const inHeaderFooter = new Set<string>()

  // ── Placeholders in the body ──────────────────────────────────────────────
  const bodyParas = paragraphs(documentXml)
  for (const para of bodyParas) {
    const names = placeholdersIn(para.text)
    for (const name of names) {
      ;(KNOWN.has(name) ? found : unknown).add(name)
      // An AI section replaces its whole paragraph, so anything else on that
      // line — words, or another placeholder after a Shift+Enter line
      // break — disappears with it.
      if (!AI_ONLY.has(name)) continue
      const rest = para.text.replace(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g, '').trim()
      if ((rest.length > 0 || names.length > 1) && !sharingParagraph.has(name)) {
        sharingParagraph.add(name)
        const softBreak = /<w:br\/>|<w:br [^>]*\/>/.test(para.xml) && !/w:type="page"/.test(para.xml)
        issues.push({
          severity: 'fix',
          message: `{{${name}}} shares its paragraph with ${names.length > 1 ? 'another placeholder' : 'other words'}${softBreak ? ' (separated by a Shift+Enter line break)' : ''}. The whole paragraph is replaced by the ${name} text, so the rest is lost. Give {{${name}}} a paragraph of its own — press Enter, not Shift+Enter.`,
          context: around(para.text, para.text.indexOf(`{{${name}`), name.length + 4),
        })
      }
    }
  }

  // ── Headers and footers ───────────────────────────────────────────────────
  for (const hf of headerFooters) {
    const text = paragraphs(hf.xml).map(p => p.text).join(' ')
    for (const name of placeholdersIn(text)) {
      ;(KNOWN.has(name) ? found : unknown).add(name)
      if (AI_ONLY.has(name) && !inHeaderFooter.has(name)) {
        inHeaderFooter.add(name)
        issues.push({
          severity: 'fix',
          message: `{{${name}}} is in a header or footer, where written sections can't go. Move it into the body of the document.`,
          context: around(text, text.indexOf(`{{${name}`), name.length + 4),
        })
      }
    }
    if (!FILLED_HEADERS_FOOTERS.has(hf.name) && placeholdersIn(text).length > 0) {
      issues.push({
        severity: 'typed',
        message: `A ${hf.name.includes('header') ? 'header' : 'footer'} that SiteIQ doesn't fill (${hf.name.replace('word/', '')}) has placeholders, so they'd be printed as typed. This happens with a different first-page or odd/even header — move the placeholders into the body, or into the main header or footer.`,
        context: around(text, text.indexOf('{{'), 30),
      })
    }
  }

  // ── Everything that looks like a placeholder but isn't one ────────────────
  const allParas = [...bodyParas, ...headerFooters.flatMap(hf => paragraphs(hf.xml))]
  const reported = new Set<string>()
  const singleBraces: { inner: string; suggestion: string | null; context: string }[] = []
  const once = (key: string, issue: TemplateIssue) => { if (!reported.has(key)) { reported.add(key); issues.push(issue) } }

  for (const para of allParas) {
    const text = para.text

    // {{ anything }} that report generation won't recognise: a misspelt or
    // made-up name, or words with spaces and hyphens.
    for (const m of text.matchAll(/\{\{([^{}]*)\}\}/g)) {
      const inner = m[1].trim()
      if (/^[a-zA-Z0-9_]+$/.test(inner) && KNOWN.has(inner)) continue
      const suggestion = suggestionFor(inner)
      once(`unknown:${inner}`, {
        severity: 'typed',
        message: `{{${inner}}} isn't a SiteIQ placeholder, so it would be printed exactly as typed.${suggestion ? ` Did you mean {{${suggestion}}}?` : ' See the list of placeholders below.'}`,
        context: around(text, m.index!, m[0].length),
      })
      if (!/^[a-zA-Z0-9_]+$/.test(inner)) unknown.add(inner)
    }

    // Unbalanced braces: {{name} or {name}}.
    for (const m of text.matchAll(/(?<!\{)\{\{([a-zA-Z0-9_ -]+)\}(?!\})|(?<!\{)\{([a-zA-Z0-9_ -]+)\}\}(?!\})/g)) {
      const inner = (m[1] ?? m[2]).trim()
      once(`unbalanced:${m[0]}`, {
        severity: 'typed',
        message: `${decode(m[0])} has mismatched braces, so it would be printed as typed. Placeholders need two on each side: {{${suggestionFor(inner) ?? inner}}}.`,
        context: around(text, m.index!, m[0].length),
      })
    }

    // Single braces: {name}. Report generation only fills {{double}} ones.
    for (const m of text.matchAll(/(?<!\{)\{([a-zA-Z][a-zA-Z0-9_ -]{0,40})\}(?!\})/g)) {
      const inner = m[1].trim()
      if (singleBraces.some(b => b.inner === inner)) continue
      singleBraces.push({ inner, suggestion: KNOWN.has(inner) ? inner : suggestionFor(inner), context: around(text, m.index!, m[0].length) })
    }
  }

  // Listed together: a template laid out for another tool can have dozens.
  if (singleBraces.length > 0) {
    const fixable = singleBraces.filter(b => b.suggestion)
    const unmatched = singleBraces.filter(b => !b.suggestion)
    issues.push({
      severity: 'typed',
      message: `${singleBraces.length === 1 ? 'This field uses' : `${singleBraces.length} fields use`} single braces, so nothing fills ${singleBraces.length === 1 ? 'it' : 'them'} and ${singleBraces.length === 1 ? 'it' : 'they'} would be printed as typed. SiteIQ only fills {{double-brace}} placeholders.`
        + (fixable.length ? ` Change ${fixable.map(b => `{${b.inner}} to {{${b.suggestion}}}`).join(', ')}.` : '')
        + (unmatched.length ? ` SiteIQ has nothing to fill ${unmatched.map(b => `{${b.inner}}`).join(', ')} with — remove ${unmatched.length === 1 ? 'it' : 'them'}, or use a placeholder from the list below.` : ''),
      context: singleBraces.length === 1 ? singleBraces[0].context : undefined,
    })
  }

  // ── SiteIQ's own section markers, left in the file ────────────────────────
  // Report generation finds the photo, markup and sketch sections it inserts
  // by bookmark name (lib/attachmentSections). A template made by editing a
  // report downloaded from SiteIQ keeps those bookmarks, and whatever sits
  // inside one is deleted the next time a report is regenerated.
  for (const xml of [documentXml, ...headerFooters.map(hf => hf.xml)]) {
    for (const m of xml.matchAll(/<w:bookmarkStart\b[^>]*\bw:name="(siteiq_[^"]*)"[^>]*>/g)) {
      const name = m[1]
      const id = m[0].match(/\bw:id="([^"]+)"/)?.[1]
      const end = id ? new RegExp(`<w:bookmarkEnd\\b[^>]*\\bw:id="${id}"`).exec(xml.slice(m.index!)) : null
      const inside = end ? xml.slice(m.index!, m.index! + end.index) : ''
      const insideText = decode(paragraphs(inside).map(p => p.text).join(' ').replace(/\s+/g, ' ').trim())
      issues.push({
        severity: 'fix',
        message: insideText
          ? `The template contains SiteIQ's hidden "${name}" marker around part of it. SiteIQ uses this name for a section it inserts, so the text inside would be deleted every time a report is regenerated. In Word: Insert → Bookmark → tick "Hidden bookmarks" → select ${name} → Delete. (This usually comes from editing a report downloaded from SiteIQ.)`
          : `The template contains SiteIQ's hidden "${name}" marker. SiteIQ uses this name for a section it inserts, and a leftover one can put photos, markups or sketches in the wrong place. In Word: Insert → Bookmark → tick "Hidden bookmarks" → select ${name} → Delete.`,
        context: insideText ? `Inside it: ${insideText.slice(0, 140)}${insideText.length > 140 ? '…' : ''}` : undefined,
      })
    }
  }

  // ── Required placeholders ─────────────────────────────────────────────────
  const missing = PLACEHOLDERS.map(p => p.name).filter(n => !found.has(n))
  const missingRequired = PLACEHOLDERS.filter(p => p.required && !found.has(p.name)).map(p => p.name)
  if (missingRequired.length) {
    issues.push({
      severity: 'fix',
      message: `Nothing will be written where the report needs it: ${missingRequired.map(n => `{{${n}}}`).join(', ')} ${missingRequired.length === 1 ? 'is' : 'are'} missing from the file.`,
    })
  }

  // ── Page width for the photo table ────────────────────────────────────────
  const sections = [...documentXml.matchAll(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g)].map(m => m[0])
  const last = sections[sections.length - 1] ?? ''
  const pageW = Number(last.match(/<w:pgSz\b[^>]*\bw:w="(\d+)"/)?.[1] ?? 0)
  const left = Number(last.match(/<w:pgMar\b[^>]*\bw:left="(\d+)"/)?.[1] ?? 0)
  const right = Number(last.match(/<w:pgMar\b[^>]*\bw:right="(\d+)"/)?.[1] ?? 0)
  const textWidth = pageW - left - right
  if (pageW > 0 && textWidth < PHOTO_TABLE_TWIPS) {
    issues.push({
      severity: 'info',
      message: `The page leaves ${(textWidth / 567).toFixed(1)} cm for text, and SiteIQ's photo pages are ${(PHOTO_TABLE_TWIPS / 567).toFixed(1)} cm wide, so photos will reach ${(((PHOTO_TABLE_TWIPS - textWidth) / 567) * 10).toFixed(0)} mm into the right margin. Narrow the side margins slightly if that matters.`,
    })
  }

  const contentControls = (documentXml.match(/<w:sdt[ >]/g) ?? []).length
    + headerFooters.reduce((n, hf) => n + (hf.xml.match(/<w:sdt[ >]/g) ?? []).length, 0)
  if (contentControls > 0) {
    issues.push({
      severity: 'info',
      message: `${contentControls} Word content control${contentControls === 1 ? '' : 's'} (date pickers, locked fields) — removed automatically from generated reports.`,
    })
  }

  const rank = { fix: 0, typed: 1, info: 2 } as const
  issues.sort((a, b) => rank[a.severity] - rank[b.severity])

  return {
    issues,
    found: [...found],
    unknown: [...unknown],
    missing,
    missingRequired,
    sharingParagraph: [...sharingParagraph],
    inHeaderFooter: [...inHeaderFooter],
    contentControls,
    ok: !issues.some(i => i.severity !== 'info'),
  }
}
