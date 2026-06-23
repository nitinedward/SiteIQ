import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs/promises'
import * as path from 'path'
import AdmZip from 'adm-zip'

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co'
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(url, key)
}

// NOTE: /tmp is ephemeral on Vercel serverless.
// Documents may not persist between requests.
// TODO: move to Supabase storage for production.
const DOCS_DIR = path.join('/tmp', 'siteiq-docs-cache')

export type TemplateData = {
  engineer_name: string
  client_email: string
  project_name: string
  report_no: string
  site_contact: string
  contact_phone: string
  weather: string
  drawings: string
  emailed_to_1: string
  emailed_to_2: string
  /** Word XML produced by buildParagraphXml() */
  purpose: string
  /** Word XML produced by buildBulletXml() */
  findings: string
  /** Word XML produced by buildBulletXml() */
  recommendations: string
  /** Word XML produced by buildParagraphXml() */
  other_activity: string
  date?: string
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

/** Download the firm's template from Supabase, cache it locally. */
async function fetchTemplateBuffer(firmId: string): Promise<Buffer> {
  console.log('[template] Loading for firm:', firmId)

  const cachePath = path.join(DOCS_DIR, `template-${firmId}.docx`)
  try {
    const cached = await fs.readFile(cachePath)
    console.log('[template] Using /tmp cache, size:', cached.length)
    return cached
  } catch {
    // Not cached — fetch from Supabase
  }

  const keySet = !!(process.env.SUPABASE_SERVICE_ROLE_KEY)
  console.log('[template] SUPABASE_SERVICE_ROLE_KEY set:', keySet)

  const supabase = getSupabase()
  const { data: firmData, error: dbError } = await supabase
    .from('firms')
    .select('report_template_url')
    .eq('id', firmId)
    .single()

  console.log('[template] DB result — url:', firmData?.report_template_url ?? null, '| error:', dbError?.message ?? null)

  if (!firmData?.report_template_url) {
    throw new Error(
      'No template uploaded. Go to Settings → Report Template and upload your .docx file.'
    )
  }

  console.log('[template] Fetching from URL:', firmData.report_template_url)
  const res = await fetch(firmData.report_template_url, {
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''}`,
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
 */
export async function fillTemplate(
  firmId: string,
  data: TemplateData,
): Promise<Buffer> {
  const templateBuffer = await fetchTemplateBuffer(firmId)
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
    '{{client_email}}':    data.client_email    || '',
    '{{project_name}}':    data.project_name    || '',
    '{{report_no}}':       data.report_no       || '',
    '{{site_contact}}':    data.site_contact    || '',
    '{{contact_phone}}':   data.contact_phone   || '',
    '{{weather}}':         data.weather         || '',
    '{{drawings}}':        data.drawings        || '',
    '{{emailed_to_1}}':    data.emailed_to_1    || '',
    '{{emailed_to_2}}':    data.emailed_to_2    || '',
    '{{date}}':            dateStr,
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
    const cleanedXml = xml.replace(/<w:color w:val="00B050"\/>/g, '<w:color w:val="000000"/>')
    if (cleanedXml !== xml || changed) {
      zip.updateFile('word/document.xml', Buffer.from(cleanedXml, 'utf-8'))
    }
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

    if (changed) {
      zip.updateFile(fileName, Buffer.from(xml, 'utf-8'))
      console.log(`[templateProcessor] Replaced inline fields in ${fileName}`)
    }
  }

  return zip.toBuffer()
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
