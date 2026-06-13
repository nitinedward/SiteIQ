import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fillTemplate, TemplateData, buildBulletXml, buildParagraphXml } from '@/lib/templateProcessor'
import { generateServerReport } from '@/lib/reportGeneratorServer'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

// NOTE: /tmp is ephemeral on Vercel serverless.
// Documents may not persist between requests.
// TODO: move to Supabase storage for production.
const DOCS_DIR = path.join('/tmp', 'siteiq-docs-cache')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(request: NextRequest) {
  try {
    const { inspectionId, photos: photoList, drawingIds: _drawingIds } = await request.json()

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

    const inspection = inspRes.data
    const projects   = (inspection.projects as any) ?? {}
    const firmId     = projects.firm_id as string | undefined

    console.log('Generating doc for:', inspectionId, '| firm:', firmId)

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

    // Build findings as Word bullet XML from observations
    const observations = obsRes.data ?? []
    const findingsLines = observations.map((ob: any) => {
      const label = ob.zone_label || 'General Observation'
      const text  = ob.transcript || ob.notes || 'Observation recorded'
      const sev   = ob.severity && ob.severity !== 'NONE' ? ` [${ob.severity}]` : ''
      return `${label}${sev}: ${text}`
    })
    const findings = buildBulletXml(
      findingsLines.length > 0 ? findingsLines : ['No specific findings recorded.']
    )

    const outputPath = path.join(DOCS_DIR, `${inspectionId}.docx`)

    if (firmId) {
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
        purpose:         buildParagraphXml(inspection.purpose ?? ''),
        findings,
        recommendations: buildBulletXml([]),
        other_activity:  buildParagraphXml(''),
        date:            inspection.date            ?? '',
      }

      await fillTemplate(firmId, templateData, outputPath)
      console.log('Document generated from firm template')
    } else {
      // Fallback: generate from scratch when no firm template is set up
      console.log('No firm_id — generating from scratch')

      const photoAttachments: { url: string; zoneLabel: string; buffer?: Buffer }[] = []
      if (Array.isArray(photoList) && photoList.length > 0) {
        await Promise.all(
          photoList.map(async (p: { url: string; zoneLabel: string }) => {
            try {
              const res = await fetch(p.url)
              if (res.ok) {
                photoAttachments.push({
                  url: p.url,
                  zoneLabel: p.zoneLabel,
                  buffer: Buffer.from(await res.arrayBuffer()),
                })
              }
            } catch { /* skip failed photo */ }
          })
        )
      }

      const buffer = await generateServerReport(inspection, observations, undefined, photoAttachments)
      await mkdir(DOCS_DIR, { recursive: true })
      await writeFile(outputPath, buffer)
    }

    return NextResponse.json({ success: true, inspectionId })
  } catch (err) {
    console.error('[docs/generate] error:', err)
    return NextResponse.json({ error: 'Failed to generate document' }, { status: 500 })
  }
}
