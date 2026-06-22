import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateServerReport } from '@/lib/reportGeneratorServer'
import { fillTemplate, TemplateData, buildBulletXml, buildParagraphXml } from '@/lib/templateProcessor'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

export const dynamic = 'force-dynamic'

// NOTE: /tmp is ephemeral on Vercel serverless.
// Documents may not persist between requests.
// TODO: move to Supabase storage for production.
const DOCS_DIR = path.join('/tmp', 'siteiq-docs-cache')

/** Extract the body text of a named CAPS section from AI output. */
function parseAISection(text: string, sectionName: string): string {
  const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(
    `${escaped}[:\\s]*([\\s\\S]*?)(?=\\n[A-Z][A-Z /()\\-]{2,}(?::|\\n)|$)`,
    'i'
  )
  const match = text.match(regex)
  return match ? match[1].trim() : ''
}

/** Convert AI section text into bullet lines (strips leading "- " or "• " markers). */
function sectionToBulletLines(text: string): string[] {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .map(l => l.replace(/^[-•]\s+/, ''))
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co'
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!supabaseKey) {
    console.error('SUPABASE_SERVICE_ROLE_KEY not set')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }
  const supabase = createClient(supabaseUrl, supabaseKey)

  try {
    const { inspectionId } = await request.json()
    if (!inspectionId) {
      return NextResponse.json({ error: 'Missing inspectionId' }, { status: 400 })
    }

    const [inspRes, obsRes] = await Promise.all([
      supabase
        .from('inspections')
        .select('*, projects(name, project_number, client_name, address, firm_id)')
        .eq('id', inspectionId)
        .single(),
      supabase
        .from('observations')
        .select('*')
        .eq('inspection_id', inspectionId)
        .order('created_at', { ascending: true }),
    ])

    if (!inspRes.data) {
      return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
    }

    const inspection   = inspRes.data
    const observations = obsRes.data ?? []
    const projects     = (inspection.projects as any) ?? {}
    const firmId       = projects.firm_id as string | undefined

    // Get engineer name from firm_members
    const userId = (inspection as any).created_by ?? (inspection as any).user_id
    const { data: member } = userId
      ? await supabase
          .from('firm_members')
          .select('full_name')
          .eq('user_id', userId)
          .single()
      : { data: null }

    const engineerName = member?.full_name ?? 'Site Engineer'

    // Build observation text for AI prompt
    const obsText = observations.map((ob: any) => {
      const zone = ob.zone_label || 'General'
      const text = ob.transcript || ob.notes || 'No notes'
      const sev  = ob.severity && ob.severity !== 'NONE' ? `Severity: ${ob.severity}` : ''
      return `Zone: ${zone}${sev ? `\n${sev}` : ''}\nNotes: ${text}`
    }).join('\n\n')

    const prompt = `You are a structural engineer writing a formal site inspection report.

Project: ${projects.name ?? ''}
Date: ${inspection.date ?? ''}
Weather: ${inspection.weather ?? ''}
Purpose: ${inspection.purpose ?? ''}

Observations from site:
${obsText || 'No observations recorded.'}

Write a professional site inspection report with EXACTLY these six section headings in ALL CAPS on their own line:

PURPOSE OF INSPECTION
WORKS OBSERVED
OBSERVATIONS/COMMENTS
CONTRACTOR TO PROVIDE (PRIOR TO NEXT INSPECTION)
HEALTH AND SAFETY
OTHER ACTIVITY ON SITE

Rules:
- Each section heading must appear alone on its own line in ALL CAPS.
- Do NOT use separator lines, dashes, underscores, or horizontal rules between sections.
- Do NOT number the headings.
- Under OBSERVATIONS/COMMENTS, write each zone observation as a separate line starting with "- ".
- Under CONTRACTOR TO PROVIDE, write each item as a separate line starting with "- ".
- Use formal structural engineering language throughout.`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_KEY ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 2000,
        messages:   [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('[ai-generate] Anthropic error:', err)
      return NextResponse.json({ error: 'AI generation failed' }, { status: 500 })
    }

    const aiData = await response.json()
    const rawAiText: string = aiData.content?.[0]?.text ?? ''

    // Clean up AI output: remove separator lines and excess blank lines
    const aiText = rawAiText
      .replace(/^[-─═=*]{3,}\s*$/gm, '')   // strip separator lines
      .replace(/\n{3,}/g, '\n\n')            // max 2 consecutive newlines
      .trim()

    console.log('AI text generated, length:', aiText.length)

    const outputPath = path.join(DOCS_DIR, `${inspectionId}.docx`)

    if (firmId) {
      const purposeText  = parseAISection(aiText, 'PURPOSE OF INSPECTION') || (inspection.purpose ?? '')
      const worksText    = parseAISection(aiText, 'WORKS OBSERVED')
      const obsText2     = parseAISection(aiText, 'OBSERVATIONS/COMMENTS')
      const recsText     = parseAISection(aiText, 'CONTRACTOR TO PROVIDE')
      const otherText    = parseAISection(aiText, 'OTHER ACTIVITY ON SITE')

      // Combine works observed + observations into bullet list
      const findingLines: string[] = [
        ...sectionToBulletLines(worksText),
        ...sectionToBulletLines(obsText2),
      ]

      const templateData: TemplateData = {
        engineer_name:   engineerName,
        client_email:    `${engineerName.toLowerCase().replace(/\s+/g, '.').replace(/[^a-z.]/g, '')}@silvesterclark.co.nz`,
        project_name:    projects.name              ?? '',
        report_no:       inspection.report_no       ?? '',
        site_contact:    inspection.site_contact    ?? '',
        contact_phone:   inspection.contact_phone   ?? '',
        weather:         inspection.weather         ?? '',
        drawings:        (inspection as any).drawing_ref ?? '',
        emailed_to_1:    projects.client_name       ?? '',
        emailed_to_2:    '',
        purpose:         buildParagraphXml(purposeText),
        findings:        buildBulletXml(findingLines.length > 0 ? findingLines : ['No specific findings recorded.']),
        recommendations: buildBulletXml(sectionToBulletLines(recsText)),
        other_activity:  buildParagraphXml(otherText),
        date:            inspection.date            ?? '',
      }

      await fillTemplate(firmId, templateData, outputPath)
      console.log('AI document generated using firm template')
    } else {
      console.log('No firm_id — generating AI doc from scratch')
      const buffer = await generateServerReport(inspection, observations, aiText)
      await mkdir(DOCS_DIR, { recursive: true })
      await writeFile(outputPath, buffer)
    }

    return NextResponse.json({ success: true, preview: aiText.slice(0, 200) })
  } catch (err) {
    console.error('[ai-generate] error:', err)
    return NextResponse.json({ error: 'AI generation failed' }, { status: 500 })
  }
}
