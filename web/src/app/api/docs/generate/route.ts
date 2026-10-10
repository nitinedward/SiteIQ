import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fillTemplate, pinReportTemplate, TemplateData, buildBulletXml, buildParagraphXml } from '@/lib/templateProcessor'
import { generateServerReport } from '@/lib/reportGeneratorServer'
import { saveDoc } from '@/lib/docStorage'
import { writeWithRebuiltAttachments } from '@/lib/rebuildAttachments'
import { quiesceGate, NotSettledError } from '@/lib/quiesceDocument'
import { parseSelected } from '@/lib/attachmentSelection'
import { noteBulletLine, noteDictation } from '@/lib/reportNotes'
import { loadReportEngineer, inspectionTime } from '@/lib/reportEngineer'
import { parseRecipients, recipientNames, recipientEmails } from '@/lib/reportRecipients'
import { requireInspectionAccess, docKeyMismatch } from '@/lib/apiAuth'
import { buildObservationBlocks, earlierNoteCount, loadPreviousItems } from '@/lib/observationBlocks'

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
    const { inspectionId, photos: photoList, drawingIds: _drawingIds, force, docKey, selectedPhotoUrls, selectedMarkups: markupStems, selectedSketches: sketchIds } = await request.json()
    // The photos, markups (stems) and sketches (ids) ticked on the report
    // page, which a forced rewrite's sections hold; absent means the
    // selection last recorded — see lib/attachmentSelection.
    const selectedUrls = parseSelected(selectedPhotoUrls)
    const selectedMarkups = parseSelected(markupStems)
    const selectedSketches = parseSelected(sketchIds)

    if (!inspectionId) {
      return NextResponse.json({ error: 'Missing inspectionId' }, { status: 400 })
    }
    const access = await requireInspectionAccess(request, inspectionId)
    if (!access.ok) return access.response
    const keyCheck = docKeyMismatch(docKey, inspectionId)
    if (keyCheck) return keyCheck.response

    // A forced rewrite replaces a document the editor had open, so its
    // parting save must land first. Started now so the wait overlaps the
    // reads, the template and fetching the photos; writeWithRebuiltAttachments
    // awaits it before touching the stored file. A first generation has no
    // session behind it and never waits.
    const gate = quiesceGate(inspectionId, force ? docKey : null)

    // Normally this only runs when no document exists yet, so it can't wipe
    // edits made in OnlyOffice. `force` is the "use the plain notes text"
    // action: the user has asked for the written sections to go back to the
    // raw observation transcripts, in place of the AI's prose. Inserted
    // photos and markups survive it — see writeWithRebuiltAttachments below.
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

    // Independent of each other, so read together. The two project columns
    // are still read on their own so a database without them yet (see
    // sql/project_client_email.sql and sql/project_report_recipients.sql)
    // still generates reports.
    const [engineer, { data: client }, { data: recipientRow }] = await Promise.all([
      loadReportEngineer(supabase, inspection as any, firmId),
      supabase
        .from('projects')
        .select('client_email')
        .eq('id', inspection.project_id)
        .single(),
      supabase
        .from('projects')
        .select('report_recipients')
        .eq('id', inspection.project_id)
        .single(),
    ])
    const recipients = parseRecipients((recipientRow as any)?.report_recipients)

    // Build findings as Word bullet XML from observations
    const observations = obsRes.data ?? []
    console.log(`[generate] observations: ${observations.length}, with transcript: ${observations.filter((o: any) => o.transcript).length}`)
    console.log(`[generate] purpose recorded on site: ${String(inspection.purpose ?? '').trim().length} chars`)
    observations.forEach((ob: any, i: number) => {
      console.log(`[generate] obs[${i}] zone="${ob.zone_label}" transcript="${(ob.transcript ?? '').substring(0, 80)}" severity="${ob.severity}"`)
    })
    // One "<label>: <text>" bullet per note — the shape finalising reads the
    // report wording back from (lib/reportNotes). The open/closed status is
    // tracked on the observation, not printed into the report text.
    const findingsLines = observations.map((ob: any) =>
      noteBulletLine(ob, noteDictation(ob) || 'Observation recorded')
    )
    const findings = buildBulletXml(
      findingsLines.length > 0 ? findingsLines : ['No specific findings recorded.']
    )

    let carried: string[] = []

    if (firmId) {
      // For templates laid out a block per note: each note's dictation as
      // recorded. Nothing writes contractor items from the plain notes.
      const observationBlocks = await buildObservationBlocks(supabase, observations, (ob: any) => ({
        finding: noteDictation(ob) || 'Observation recorded',
        action: '',
      }), await earlierNoteCount(supabase, inspection as any))
      const templateData: TemplateData = {
        engineer_name:   engineer.name,
        engineer_user:   engineer.user,
        client_email:    client?.client_email ?? '',
        project_name:    projects.name              ?? '',
        job_no:          projects.project_number    ?? '',
        report_no:       inspection.report_no       ?? '',
        site_contact:    inspection.site_contact    ?? '',
        contact_phone:   inspection.contact_phone   ?? '',
        weather:         inspection.weather         ?? '',
        drawings:        (inspection as any).drawing_ref ?? '',
        emailed_to_1:    recipients[0]?.name || (projects.client_name ?? ''),
        emailed_to_2:    recipientNames(recipients.slice(1)),
        issued_to:       recipientNames(recipients) || (projects.client_name ?? ''),
        issued_to_emails: recipientEmails(recipients),
        purpose:         buildParagraphXml(inspection.purpose ?? ''),
        findings,
        recommendations: buildBulletXml([]),
        other_activity:  buildParagraphXml(''),
        date:            inspection.date            ?? '',
        time:            inspectionTime(inspection as any),
        observations:    observationBlocks,
        previousItems:   await loadPreviousItems(supabase, inspection as any),
      }

      const pinnedTemplateId = (inspection as any).report_template_id as string | null | undefined
      const { buffer, templateId } = await fillTemplate(firmId, templateData, {
        pinnedTemplateId,
        projectId: inspection.project_id,
      })
      await pinReportTemplate(inspectionId, pinnedTemplateId, templateId)
      // A forced rewrite replaces a document that may already hold inserted
      // photos and markups; a first generation has nothing to carry.
      carried = force
        ? await writeWithRebuiltAttachments(inspectionId, inspection.project_id, buffer, { gate, photos: selectedUrls, drawings: selectedMarkups, sketches: selectedSketches })
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
        ? await writeWithRebuiltAttachments(inspectionId, inspection.project_id, buffer, { gate, photos: selectedUrls, drawings: selectedMarkups, sketches: selectedSketches })
        : (await saveDoc(inspectionId, buffer), [])
    }

    return NextResponse.json({ success: true, inspectionId, carried })
  } catch (err) {
    if (err instanceof NotSettledError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    console.error('[docs/generate] error:', err)
    return NextResponse.json({ error: 'Failed to generate document' }, { status: 500 })
  }
}
