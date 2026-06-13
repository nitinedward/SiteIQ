import { createClient } from '@supabase/supabase-js'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Docxtemplater = require('docxtemplater')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PizZip = require('pizzip')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

/** Download the firm's .docx template from Supabase storage, or null if not set. */
export async function fetchFirmTemplate(firmId: string): Promise<Buffer | null> {
  try {
    const { data: firmData } = await supabase
      .from('firms')
      .select('report_template_url')
      .eq('id', firmId)
      .single()

    if (!firmData?.report_template_url) return null

    console.log('Fetching firm template:', firmData.report_template_url)
    const res = await fetch(firmData.report_template_url, {
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      },
    })
    if (!res.ok) {
      console.warn('Template fetch failed:', res.status)
      return null
    }
    const buf = Buffer.from(await res.arrayBuffer())
    console.log('Template fetched, size:', buf.length)
    return buf
  } catch (err) {
    console.warn('Template fetch error:', err)
    return null
  }
}

/** Parse AI plain-text into named sections keyed by heading. */
function parseAiSections(text: string): Record<string, string> {
  const sections: Record<string, string> = {}
  const lines = text.split('\n')
  let currentKey = ''
  let currentLines: string[] = []

  const flush = () => {
    if (currentKey) sections[currentKey] = currentLines.join('\n').trim()
  }

  for (const line of lines) {
    const trimmed = line.trim()
    // ALL-CAPS lines are section headings
    if (trimmed.length > 4 && trimmed === trimmed.toUpperCase() && /^[A-Z\s/()\-]+$/.test(trimmed)) {
      flush()
      currentKey = trimmed
      currentLines = []
    } else {
      currentLines.push(line)
    }
  }
  flush()
  return sections
}

/**
 * Fill a .docx template buffer with inspection + AI data via docxtemplater.
 * Returns the filled buffer, or the template as-is if rendering fails.
 */
export function fillTemplate(
  templateBuffer: Buffer,
  fields: Record<string, string>,
): Buffer {
  try {
    const zip = new PizZip(templateBuffer)
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => '',
    })
    doc.render(fields)
    return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
  } catch (err) {
    console.warn('docxtemplater render failed, using template as-is:', err)
    return templateBuffer
  }
}

/** Build the standard header fields from inspection + project data. */
export function buildBaseFields(inspection: any, projects: any): Record<string, string> {
  return {
    project_name:  projects.name            ?? '',
    PROJECT_NAME:  projects.name            ?? '',
    job_name:      projects.name            ?? '',
    JOB_NAME:      projects.name            ?? '',
    report_no:     inspection.report_no     ?? '',
    REPORT_NO:     inspection.report_no     ?? '',
    job_no:        projects.project_number  ?? '',
    JOB_NO:        projects.project_number  ?? '',
    date:          inspection.date          ?? '',
    DATE:          inspection.date          ?? '',
    weather:       inspection.weather       ?? '',
    WEATHER:       inspection.weather       ?? '',
    site_contact:  inspection.site_contact  ?? '',
    SITE_CONTACT:  inspection.site_contact  ?? '',
    contact_phone: inspection.contact_phone ?? '',
    CONTACT_PHONE: inspection.contact_phone ?? '',
    purpose:       inspection.purpose       ?? '',
    PURPOSE:       inspection.purpose       ?? '',
    client_name:   projects.client_name     ?? '',
    CLIENT_NAME:   projects.client_name     ?? '',
    address:       projects.address         ?? '',
    ADDRESS:       projects.address         ?? '',
  }
}

/** Build fields that include AI-generated section text. */
export function buildAiFields(inspection: any, projects: any, aiText: string): Record<string, string> {
  const base = buildBaseFields(inspection, projects)
  const sections = parseAiSections(aiText)

  // Normalise section keys to lowercase slugs for matching
  const sectionFields: Record<string, string> = {}
  for (const [heading, content] of Object.entries(sections)) {
    const key = heading.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    sectionFields[key] = content
    sectionFields[key.toUpperCase()] = content
  }

  // Well-known aliases
  const get = (...keys: string[]) => keys.map(k => sections[k] ?? '').find(v => v) ?? ''

  return {
    ...base,
    ...sectionFields,
    ai_content:               aiText,
    AI_CONTENT:               aiText,
    purpose_of_inspection:    get('PURPOSE OF INSPECTION') || (inspection.purpose ?? ''),
    PURPOSE_OF_INSPECTION:    get('PURPOSE OF INSPECTION') || (inspection.purpose ?? ''),
    works_observed:           get('WORKS OBSERVED'),
    WORKS_OBSERVED:           get('WORKS OBSERVED'),
    observations_comments:    get('OBSERVATIONS/COMMENTS', 'OBSERVATIONS', 'COMMENTS'),
    OBSERVATIONS_COMMENTS:    get('OBSERVATIONS/COMMENTS', 'OBSERVATIONS', 'COMMENTS'),
    contractor_to_provide:    get('CONTRACTOR TO PROVIDE (PRIOR TO NEXT INSPECTION)', 'CONTRACTOR TO PROVIDE'),
    CONTRACTOR_TO_PROVIDE:    get('CONTRACTOR TO PROVIDE (PRIOR TO NEXT INSPECTION)', 'CONTRACTOR TO PROVIDE'),
    health_and_safety:        get('HEALTH AND SAFETY'),
    HEALTH_AND_SAFETY:        get('HEALTH AND SAFETY'),
    other_activity:           get('OTHER ACTIVITY ON SITE', 'OTHER ACTIVITY'),
    OTHER_ACTIVITY:           get('OTHER ACTIVITY ON SITE', 'OTHER ACTIVITY'),
  }
}
