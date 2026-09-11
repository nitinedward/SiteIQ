import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fillTemplate, TemplateData, buildBulletXml, buildParagraphXml } from '@/lib/templateProcessor'
import { generateServerReport } from '@/lib/reportGeneratorServer'
import { saveDoc } from '@/lib/docStorage'
import { writeWithAttachments } from '@/lib/attachmentSections'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co'
  const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()
  if (!supabaseKey) {
    console.error('SUPABASE_SERVICE_ROLE_KEY not set')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }
  const supabase = createClient(supabaseUrl, supabaseKey)

  try {
    const { inspectionId, photos: photoList, drawingIds: _drawingIds, force } = await request.json()

    if (!inspectionId) {
      return NextResponse.json({ error: 'Missing inspectionId' }, { status: 400 })
    }

    // Normally this only runs when no document exists yet, so it can't wipe
    // edits made in OnlyOffice. `force` is the "use the plain notes text"
    // action: the user has asked for the written sections to go back to the
    // raw observation transcripts, in place of the AI's prose. Inserted
    // photos and markups survive it — see writeWithAttachments below.
    const { error: existErr } = await supabase.storage
      .from('reports')
      .createSignedUrl(`${inspectionId}.docx`, 10)
    if (!existErr && !force) {
      console.log('[generate] Doc already exists, skipping to preserve OO edits')
      return NextResponse.json({ success: true, inspectionId, skipped: true })
    }
    if (!existErr && force) {
      console.log('[generate] Rewriting the text from notes at the user’s request')
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
        .order('id', { ascending: true }),
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
    console.log(`[generate] observations: ${observations.length}, with transcript: ${observations.filter((o: any) => o.transcript).length}`)
    observations.forEach((ob: any, i: number) => {
      console.log(`[generate] obs[${i}] zone="${ob.zone_label}" transcript="${(ob.transcript ?? '').substring(0, 80)}" severity="${ob.severity}"`)
    })
    const findingsLines = observations.map((ob: any) => {
      const label = ob.zone_label || 'General Observation'
      const text  = ob.transcript || ob.notes || 'Observation recorded'
      // The open/closed status is tracked on the observation, not printed
      // into the report text.
      return `${label}: ${text}`
    })
    const findings = buildBulletXml(
      findingsLines.length > 0 ? findingsLines : ['No specific findings recorded.']
    )

    let carried: string[] = []

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

      const buffer = await fillTemplate(firmId, templateData)
      // A forced rewrite replaces a document that may already hold inserted
      // photos and markups; a first generation has nothing to carry.
      carried = force
        ? await writeWithAttachments(inspectionId, buffer)
        : (await saveDoc(inspectionId, buffer), [])
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
      carried = force
        ? await writeWithAttachments(inspectionId, buffer)
        : (await saveDoc(inspectionId, buffer), [])
    }

    return NextResponse.json({ success: true, inspectionId, carried })
  } catch (err) {
    console.error('[docs/generate] error:', err)
    return NextResponse.json({ error: 'Failed to generate document' }, { status: 500 })
  }
}
