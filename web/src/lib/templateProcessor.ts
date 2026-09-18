import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs/promises'
import * as path from 'path'
import AdmZip from 'adm-zip'

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co'
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(url, key)
}

// NOTE: /tmp is ephemeral on Vercel serverless.
// Documents may not persist between requests.
// TODO: move to Supabase storage for production.
const DOCS_DIR = path.join('/tmp', 'siteiq-docs-cache')

export type TemplateData = {
  engineer_name: string
  /** The engineer's email name — "nitin.edward" — for templates that write
   *  the address themselves as {{engineer_user}}@yourfirm.co.nz */
  engineer_user: string
  /** The client's address, from the project. Blank when none is set. */
  client_email: string
  project_name: string
  /** The project's own number — the job, not the visit. */
  job_no: string
  report_no: string
  site_contact: string
  contact_phone: string
  weather: string
  drawings: string
  emailed_to_1: string
  emailed_to_2: string
  /** Everyone the project issues its reports to, by name. */
  issued_to: string
  /** Their addresses, in the same order. */
  issued_to_emails: string
  /** Word XML produced by buildParagraphXml() */
  purpose: string
  /** Word XML produced by buildBulletXml() */
  findings: string
  /** Word XML produced by buildBulletXml() */
  recommendations: string
  /** Word XML produced by buildParagraphXml() */
  other_activity: string
  date?: string
  /** When the inspection was started, as "14:00". */
  time?: string
}

// ── XML Helpers ────────────────────────────────────────────────────────────────

export function xmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

const RUN_PROPS = `<w:rPr><w:color w:val="000000"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>`

/**
 * Build Word XML for a bullet list.
 * Each line becomes one indented paragraph with a • prefix, in black 11pt.
 */
export function buildBulletXml(lines: string[]): string {
  const nonempty = lines.map(l => l.trim()).filter(l => l.length > 0)
  if (nonempty.length === 0) return `<w:p><w:r><w:t></w:t></w:r></w:p>`
  return nonempty.map(line =>
    `<w:p><w:pPr><w:ind w:left="360"/></w:pPr>` +
    `<w:r>${RUN_PROPS}<w:t xml:space="preserve">•  ${xmlEscape(line)}</w:t></w:r></w:p>`
  ).join('')
}

/**
 * Build Word XML for plain paragraphs (one per non-empty line), in black 11pt.
 */
export function buildParagraphXml(text: string): string {
  const lines = (text || '').split('\n').map(l => l.trim()).filter(l => l.length > 0)
  if (lines.length === 0) return `<w:p><w:r><w:t></w:t></w:r></w:p>`
  return lines.map(line =>
    `<w:p><w:r>${RUN_PROPS}<w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r></w:p>`
  ).join('')
}

/**
 * Word frequently splits placeholder text like {{findings}} across multiple
 * <w:r> runs (e.g. due to spell-check probes, autocorrect, or copy-paste
 * artefacts). This causes both the paragraph-regex and xml.includes() checks
 * to fail, leaving the placeholder unreplaced in the output.
 *
 * This function scans every <w:p> paragraph. If the paragraph's combined
 * <w:t> text contains `{{`, it merges all runs into a single run so the
 * placeholder appears as a continuous string. Paragraphs without `{{` are
 * left untouched.
 */
function mergeRunsContainingPlaceholders(xml: string): string {
  return xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (para) => {
    // Concatenate text from every <w:t> in this paragraph
    const allText = [...para.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
      .map(m => m[1])
      .join('')

    // Only touch paragraphs that contain placeholder start marker
    if (!allText.includes('{{')) return para

    // Preserve formatting: grab <w:rPr> from the first run
    const rPr = para.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? ''

    // Strip all runs and run-splitting artefacts, then inject one clean run
    const stripped = para
      .replace(/<w:r[ >][\s\S]*?<\/w:r>/g, '')
      .replace(/<w:proofErr[^/]*\/>/g, '')
      .replace(/<w:bookmarkStart[^/]*\/>/g, '')
      .replace(/<w:bookmarkEnd[^/]*\/>/g, '')

    const newRun = `<w:r>${rPr}<w:t xml:space="preserve">${allText}</w:t></w:r>`
    return stripped.replace(/<\/w:p>/, `${newRun}</w:p>`)
  })
}

/**
 * Strip Word content controls, keeping everything inside them.
 *
 * The template is built from content controls — a date picker, "click or tap"
 * boxes, locked labels. Filling a placeholder only changes the text inside
 * its control, so the finished report still showed shaded boxes, and the
 * locked ones (w:lock) couldn't be edited in the editor at all. The controls
 * are wrappers, so dropping the wrapper tags leaves the paragraphs, rows and
 * runs they held exactly where they were.
 */
function flattenContentControls(xml: string): string {
  return xml
    .replace(/<w:sdtPr>[\s\S]*?<\/w:sdtPr>/g, '')
    .replace(/<w:sdtEndPr>[\s\S]*?<\/w:sdtEndPr>/g, '')
    .replace(/<w:sdtPr\/>|<w:sdtEndPr\/>/g, '')
    .replace(/<\/?w:sdtContent>/g, '')
    .replace(/<\/?w:sdt>/g, '')
    // Placeholder styling, which otherwise leaves filled text looking greyed out.
    .replace(/<w:rStyle w:val="PlaceholderText"\/>/g, '')
}

/**
 * Replace the entire <w:p> block that contains `placeholder` with `replacementXml`.
 * Uses a tempered greedy token to avoid crossing paragraph boundaries.
 * Returns the original xml unchanged if no match is found.
 */
function replaceParagraphWithXml(xml: string, placeholder: string, replacementXml: string): string {
  const escapedPh = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Match <w:p> optionally with attributes, containing the placeholder, ending at </w:p>
  const regex = new RegExp(
    `<w:p(?:\\s[^>]*)?>(?:(?!</w:p>)[\\s\\S])*?${escapedPh}(?:(?!</w:p>)[\\s\\S])*?</w:p>`,
    'g'
  )
  return xml.replace(regex, replacementXml)
}

// ── Template Fetch ─────────────────────────────────────────────────────────────

export type TemplateChoice = {
  /** The template the report was first built from, if any (inspections.report_template_id). */
  pinnedTemplateId?: string | null
  /** The report's project; its report_template_id is used when the report isn't pinned. */
  projectId?: string | null
}

type ResolvedTemplate = { templateId: string | null; url: string; cacheName: string }

/**
 * Pick the template for a report: the one it was first built from, else the
 * project's, else the firm's default. Falls back to the legacy single
 * firms.report_template_url when the firm has no named templates (or the
 * report_templates migration hasn't been run).
 */
async function resolveTemplate(firmId: string, choice: TemplateChoice): Promise<ResolvedTemplate> {
  const supabase = getSupabase()

  const { data: templates, error } = await supabase
    .from('report_templates')
    .select('id, file_url, is_default, updated_at')
    .eq('firm_id', firmId)

  if (error) console.warn('[template] report_templates lookup failed, using firm template:', error.message)

  const list = templates ?? []
  let projectTemplateId: string | null = null
  if (list.length > 0 && !choice.pinnedTemplateId && choice.projectId) {
    const { data: project } = await supabase
      .from('projects')
      .select('report_template_id')
      .eq('id', choice.projectId)
      .single()
    projectTemplateId = project?.report_template_id ?? null
  }

  const match =
    list.find(t => t.id === choice.pinnedTemplateId) ??
    list.find(t => t.id === projectTemplateId) ??
    list.find(t => t.is_default)

  if (match) {
    const version = new Date(match.updated_at).getTime()
    return { templateId: match.id, url: match.file_url, cacheName: `template-${match.id}-${version}.docx` }
  }

  const { data: firmData, error: dbError } = await supabase
    .from('firms')
    .select('report_template_url')
    .eq('id', firmId)
    .single()

  console.log('[template] Firm template url:', firmData?.report_template_url ?? null, '| error:', dbError?.message ?? null)

  if (!firmData?.report_template_url) {
    throw new Error(
      'No template uploaded. Go to Settings → Report templates and upload your .docx file.'
    )
  }
  return { templateId: null, url: firmData.report_template_url, cacheName: `template-${firmId}.docx` }
}

/** Download a template from Supabase, cache it locally. */
async function fetchTemplateBuffer(template: ResolvedTemplate): Promise<Buffer> {
  console.log('[template] Loading:', template.templateId ?? 'firm template')

  const cachePath = path.join(DOCS_DIR, template.cacheName)
  try {
    const cached = await fs.readFile(cachePath)
    console.log('[template] Using /tmp cache, size:', cached.length)
    return cached
  } catch {
    // Not cached — fetch from Supabase
  }

  console.log('[template] Fetching from URL:', template.url)
  const res = await fetch(template.url, {
    headers: {
      Authorization: `Bearer ${(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()}`,
    },
  })
  console.log('[template] Fetch status:', res.status, res.statusText)

  if (!res.ok) {
    throw new Error(`Template download failed: ${res.status} ${res.statusText}`)
  }

  const buffer = Buffer.from(await res.arrayBuffer())
  console.log('[template] Downloaded, size:', buffer.length)

  await fs.mkdir(DOCS_DIR, { recursive: true })
  await fs.writeFile(cachePath, buffer)

  return buffer
}

// ── Main Fill ─────────────────────────────────────────────────────────────────

/**
 * Fill the firm's Word template and write to outputPath.
 *
 * Multi-line fields (findings, purpose, recommendations, other_activity) are
 * expected to be pre-built Word XML via buildBulletXml / buildParagraphXml.
 * The entire <w:p> containing the placeholder is swapped out, which removes
 * any green colour inherited from the template's placeholder styling.
 *
 * Single-line inline fields (names, dates, etc.) use simple string replacement.
 *
 * Returns the id of the named template used (null for the legacy firm
 * template), so callers can pin the report to it.
 */
export async function fillTemplate(
  firmId: string,
  data: TemplateData,
  choice: TemplateChoice = {},
): Promise<{ buffer: Buffer; templateId: string | null }> {
  const template = await resolveTemplate(firmId, choice)
  const templateBuffer = await fetchTemplateBuffer(template)
  const zip = new AdmZip(templateBuffer)

  const dateStr =
    data.date ||
    new Date().toLocaleDateString('en-NZ', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })

  // ── Multi-line fields: replace entire <w:p> to clear template colour ─────────
  const multiLine: Record<string, string> = {
    '{{findings}}':        data.findings        || `<w:p><w:r><w:t></w:t></w:r></w:p>`,
    '{{purpose}}':         data.purpose         || `<w:p><w:r><w:t></w:t></w:r></w:p>`,
    '{{recommendations}}': data.recommendations || `<w:p><w:r><w:t></w:t></w:r></w:p>`,
    '{{other_activity}}':  data.other_activity  || `<w:p><w:r><w:t></w:t></w:r></w:p>`,
  }

  // ── Single-line inline fields: plain text replacement ─────────────────────────
  const inline: Record<string, string> = {
    '{{engineer_name}}':   data.engineer_name   || '',
    '{{engineer_user}}':   data.engineer_user   || '',
    '{{client_email}}':    data.client_email    || '',
    '{{project_name}}':    data.project_name    || '',
    '{{job_no}}':          data.job_no          || '',
    '{{report_no}}':       data.report_no       || '',
    '{{site_contact}}':    data.site_contact    || '',
    '{{contact_phone}}':   data.contact_phone   || '',
    '{{weather}}':         data.weather         || '',
    '{{drawings}}':        data.drawings        || '',
    '{{emailed_to_1}}':    data.emailed_to_1    || '',
    '{{emailed_to_2}}':    data.emailed_to_2    || '',
    '{{issued_to}}':       data.issued_to       || '',
    '{{issued_to_emails}}': data.issued_to_emails || '',
    '{{date}}':            dateStr,
    '{{time}}':            data.time            || '',
  }

  // Process document.xml: paragraph-level replacement first, then inline
  const docEntry = zip.getEntry('word/document.xml')
  if (docEntry) {
    // Normalise split runs BEFORE any replacement so {{placeholders}} that
    // Word fragmented across multiple <w:r> elements are reunited.
    let xml = mergeRunsContainingPlaceholders(docEntry.getData().toString('utf-8'))
    let changed = false

    console.log('[templateProcessor] Normalised doc XML, looking for placeholders...')
    for (const ph of Object.keys(multiLine)) {
      console.log(`[templateProcessor] ${ph} present after normalise:`, xml.includes(ph))
    }

    for (const [ph, replacementXml] of Object.entries(multiLine)) {
      const updated = replaceParagraphWithXml(xml, ph, replacementXml)
      if (updated !== xml) {
        xml = updated
        changed = true
        console.log(`[templateProcessor] Paragraph-replaced ${ph}`)
      } else if (xml.includes(ph)) {
        // Fallback: simple text replacement if regex didn't find the paragraph boundary
        // (e.g. placeholder split across XML runs)
        const stripped = replacementXml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        xml = xml.replaceAll(ph, xmlEscape(stripped))
        changed = true
        console.log(`[templateProcessor] Fallback text-replaced ${ph}`)
      }
    }

    for (const [ph, value] of Object.entries(inline)) {
      if (xml.includes(ph)) {
        xml = xml.replaceAll(ph, xmlEscape(value))
        changed = true
      }
    }

    // Strip any remaining green placeholder colour (#00B050) — applies to inline
    // fields whose <w:rPr> wasn't replaced as part of a paragraph-level swap.
    // The report is a document to edit, not a form, so the template's content
    // controls come off with it — otherwise the written sections stay boxed and
    // the locked ones can't be edited at all.
    const cleanedXml = flattenContentControls(
      xml.replace(/<w:color w:val="00B050"\/>/g, '<w:color w:val="000000"/>')
    )
    zip.updateFile('word/document.xml', Buffer.from(cleanedXml, 'utf-8'))
    if (!changed) console.log('[templateProcessor] No placeholders replaced in document.xml')
  }

  // Process headers/footers: inline fields only
  for (const fileName of ['word/header1.xml', 'word/header2.xml', 'word/footer1.xml']) {
    const entry = zip.getEntry(fileName)
    if (!entry) continue

    let xml = entry.getData().toString('utf-8')
    let changed = false

    for (const [ph, value] of Object.entries(inline)) {
      if (xml.includes(ph)) {
        xml = xml.replaceAll(ph, xmlEscape(value))
        changed = true
      }
    }

    const flattened = flattenContentControls(xml)
    if (changed || flattened !== xml) {
      zip.updateFile(fileName, Buffer.from(flattened, 'utf-8'))
      console.log(`[templateProcessor] Replaced inline fields in ${fileName}`)
    }
  }

  return { buffer: zip.toBuffer(), templateId: template.templateId }
}

/**
 * Record the template a report was first built from, so changing the
 * project's template later only affects reports generated after the change.
 */
export async function pinReportTemplate(inspectionId: string, pinnedTemplateId: string | null | undefined, usedTemplateId: string | null): Promise<void> {
  if (pinnedTemplateId || !usedTemplateId) return
  const { error } = await getSupabase()
    .from('inspections')
    .update({ report_template_id: usedTemplateId })
    .eq('id', inspectionId)
    .is('report_template_id', null)
  if (error) console.warn('[template] Could not pin report template:', error.message)
}

/** Bust the local template cache for a firm (call after uploading a new template). */
export async function clearTemplateCache(firmId: string): Promise<void> {
  const cachePath = path.join(DOCS_DIR, `template-${firmId}.docx`)
  try {
    await fs.unlink(cachePath)
    console.log('[templateProcessor] Cache cleared:', cachePath)
  } catch {
    // File may not exist — fine
  }
}
