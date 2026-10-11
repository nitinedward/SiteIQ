import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import AdmZip from 'adm-zip'
import { fillTemplate } from '@/lib/templateProcessor'
import { loadDoc, saveDoc } from '@/lib/docStorage'
import { quiesceGate, NotSettledError } from '@/lib/quiesceDocument'
import { requireInspectionAccess, docKeyMismatch } from '@/lib/apiAuth'
import { chooseCarryForward, loadPreviousItems, replaceOpenItems } from '@/lib/observationBlocks'

export const dynamic = 'force-dynamic'

/**
 * Refills only the report's earlier-items table ({{#open_items}}) and its
 * {{carried_…}} counts, with the items `carryForward` picks — the report
 * page's "Update earlier items table". The written sections, edits made in
 * the editor, photos and markups are left exactly as they are.
 *
 * The report's own template (it is pinned) is filled afresh with just those
 * items, and the marked table and counts are swapped for its copies (see
 * replaceOpenItems in lib/observationBlocks). A report generated before the
 * table was marked answers 422: it needs one full rewrite first.
 *
 * Like the rewrites, it is called with the closed editor session's docKey,
 * and waits for that session's parting save before reading the file.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
    (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()
  )

  try {
    const { inspectionId, docKey, carryForward } = await request.json()
    if (!inspectionId) {
      return NextResponse.json({ error: 'Missing inspectionId' }, { status: 400 })
    }
    const access = await requireInspectionAccess(request, inspectionId)
    if (!access.ok) return access.response
    const keyCheck = docKeyMismatch(docKey, inspectionId)
    if (keyCheck) return keyCheck.response

    // Started now so the wait overlaps the reads and the template.
    const gate = quiesceGate(inspectionId, docKey)

    const { data: inspection } = await supabase
      .from('inspections')
      .select('*, projects(firm_id)')
      .eq('id', inspectionId)
      .single()
    if (!inspection) {
      return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
    }
    if ((inspection as any).report_status === 'finalised') {
      return NextResponse.json({ error: 'This report is finalised and can no longer be changed.' }, { status: 409 })
    }
    const firmId = (inspection.projects as any)?.firm_id as string | undefined
    if (!firmId) {
      return NextResponse.json({ error: 'This report has no firm template to take the table from.' }, { status: 422 })
    }

    const mode = await chooseCarryForward(supabase, inspection as any, carryForward)
    const previousItems = await loadPreviousItems(supabase, inspection as any, mode)

    // Only the earlier items matter in this copy: nothing else is taken
    // from it.
    const { buffer: freshBuffer } = await fillTemplate(firmId, {
      engineer_name: '', engineer_user: '', client_email: '', project_name: '', job_no: '',
      report_no: '', site_contact: '', contact_phone: '', weather: '', drawings: '',
      emailed_to_1: '', emailed_to_2: '', issued_to: '', issued_to_emails: '',
      purpose: '', findings: '', recommendations: '', other_activity: '',
      observations: [],
      previousItems,
    }, {
      pinnedTemplateId: (inspection as any).report_template_id,
      projectId: inspection.project_id,
    })
    const freshXml = new AdmZip(freshBuffer).getEntry('word/document.xml')?.getData().toString('utf-8') ?? ''

    await gate
    const report = new AdmZip(await loadDoc(inspectionId))
    const entry = report.getEntry('word/document.xml')
    if (!entry) throw new Error('The stored report has no document.xml')

    const result = replaceOpenItems(entry.getData().toString('utf-8'), freshXml)
    if (result.tables === 0) {
      return NextResponse.json({
        error: 'This report’s earlier items table can’t be found on its own — it was made before this '
          + 'button existed, or the table was changed by hand. Use “Use My Notes Text” or '
          + '“Generate AI Report” once; after that the table can be updated by itself.',
      }, { status: 422 })
    }
    report.updateFile('word/document.xml', Buffer.from(result.xml, 'utf-8'))
    await saveDoc(inspectionId, report.toBuffer())
    console.log(`[update-open-items] ${inspectionId}: ${mode}, ${previousItems.length} items, ${result.tables} table(s), ${result.counts} count(s)`)

    return NextResponse.json({ success: true, mode, items: previousItems.length, counts: result.counts })
  } catch (err) {
    if (err instanceof NotSettledError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    console.error('[update-open-items] error:', err)
    return NextResponse.json({ error: 'Could not update the earlier items table' }, { status: 500 })
  }
}
