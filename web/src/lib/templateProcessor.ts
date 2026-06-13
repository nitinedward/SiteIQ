import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs/promises'
import * as path from 'path'
import AdmZip from 'adm-zip'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

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
  const cachePath = path.join(DOCS_DIR, `template-${firmId}.docx`)

  try {
    const cached = await fs.readFile(cachePath)
    console.log('[templateProcessor] Using cached template:', cachePath)
    return cached
  } catch {
    // Not cached yet
  }

  const { data: firmData } = await supabase
    .from('firms')
    .select('report_template_url')
    .eq('id', firmId)
    .single()

  if (!firmData?.report_template_url) {
    throw new Error(
      'No template uploaded. Go to Settings → Report Template and upload your .docx file.'
    )
  }

  console.log('[templateProcessor] Downloading template:', firmData.report_template_url)
  const res = await fetch(firmData.report_template_url, {
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
    },
  })
  if (!res.ok) {
    throw new Error(`Template download failed: ${res.status} ${res.statusText}`)
  }

  const buffer = Buffer.from(await res.arrayBuffer())

  await fs.mkdir(DOCS_DIR, { recursive: true })
  await fs.writeFile(cachePath, buffer)
  console.log('[templateProcessor] Template cached at:', cachePath)

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
  outputPath: string,
): Promise<void> {
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
    let xml = docEntry.getData().toString('utf-8')
    let changed = false

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

  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  zip.writeZip(outputPath)
  console.log('[templateProcessor] Filled template saved to:', outputPath)
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
