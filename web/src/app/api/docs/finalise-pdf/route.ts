import { NextRequest, NextResponse } from 'next/server'
import { savePdf } from '@/lib/docStorage'
import { forceSaveAndWait, convertDocxToPdf } from '@/lib/onlyofficeConvert'
import { reportFileNameFor } from '@/lib/reportFileNameServer'
import { ensurePdfTitle } from '@/lib/pdfTitle'
import { syncReportWordingToNotes, type WordingSyncResult } from '@/lib/reportWordingSync'
import { addDrawingHotspots, type HotspotSpec } from '@/lib/reportPdfHotspots'
import { createClient } from '@supabase/supabase-js'

/** The markups on this report's drawings, for the clickable areas. */
async function loadHotspotSpec(inspectionId: string): Promise<HotspotSpec> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
      (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()
    )
    const { data } = await supabase
      .from('zones')
      .select('id, label, x_percent, y_percent, markup_type, shape_data, drawings(number, revision)')
      .eq('inspection_id', inspectionId)

    return {
      zones: (data ?? []).map((z: any) => ({
        id: z.id,
        label: z.label,
        x_percent: z.x_percent,
        y_percent: z.y_percent,
        markup_type: z.markup_type ?? 'pin',
        shape_data: z.shape_data ?? null,
        drawingNumber: z.drawings?.number ?? null,
        drawingRevision: z.drawings?.revision ?? null,
      })),
    }
  } catch (err) {
    console.warn('[finalise-pdf] could not load markups for hotspots:', err)
    return { zones: [] }
  }
}

export const dynamic = 'force-dynamic'
// Force-save (~10s) + conversion polling (~90s worst case for a large,
// photo-heavy report) can exceed the platform's default function timeout.
// Vercel caps this to whatever the account's plan actually allows, but
// declaring it costs nothing and gets us the full budget where possible.
export const maxDuration = 120

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: cors })
}

/** Force-saves the live OnlyOffice document, converts the resulting .docx
 *  to PDF, and stores the PDF — but does NOT touch report_status. The
 *  caller (client) only flips the inspection to 'finalised' after this
 *  returns success, so a report is never marked finalised without a valid
 *  frozen PDF actually existing. */
export async function POST(request: NextRequest) {
  try {
    const { inspectionId, docKey } = await request.json()
    if (!inspectionId || !docKey) {
      return NextResponse.json({ error: 'Missing inspectionId or docKey' }, { status: 400, headers: cors })
    }

    console.log('[finalise-pdf] Force-saving before freeze:', inspectionId)
    const saveResult = await forceSaveAndWait(inspectionId, docKey)
    console.log('[finalise-pdf] Force-save result:', saveResult)

    const appUrl = process.env.NEXT_PUBLIC_APP_URL
      ?? new URL(request.url).origin

    console.log('[finalise-pdf] Converting to PDF:', inspectionId)
    // The frozen PDF is the copy people keep and pass around, so it carries
    // the report's name inside it rather than the inspection UUID.
    const title = await reportFileNameFor(inspectionId)
    const converted = await convertDocxToPdf(inspectionId, appUrl, title)
    // Stamped again here rather than trusting the conversion to have taken
    // the title — this is the copy that gets viewed, downloaded and emailed.
    const { bytes: stamped } = await ensurePdfTitle(converted, title)

    // The drawings arrive from the conversion as flat pictures; this puts the
    // markups back to work, each area jumping to its own photos.
    const pdfBuffer = await addDrawingHotspots(Buffer.from(stamped), await loadHotspotSpec(inspectionId))

    await savePdf(inspectionId, pdfBuffer)
    console.log('[finalise-pdf] PDF stored as:', title, 'size:', pdfBuffer.length)

    // The report's final wording for each site note goes back onto the note.
    // A failure here is reported but never blocks the finalise.
    let wording: WordingSyncResult | null = null
    try {
      wording = await syncReportWordingToNotes(inspectionId)
      console.log('[finalise-pdf] Report wording saved to notes:', wording.updated, '| unmatched:', wording.unmatched)
    } catch (err) {
      console.error('[finalise-pdf] Could not save report wording to notes:', err)
    }

    return NextResponse.json({ success: true, pdfSize: pdfBuffer.length, wording }, { headers: cors })
  } catch (err: any) {
    console.error('[finalise-pdf] error:', err)
    // Never a partial success — the caller must not mark the report
    // finalised if this errors, so a report can't end up "finalised"
    // without a valid PDF.
    return NextResponse.json({ error: err.message || 'Failed to finalise to PDF' }, { status: 500, headers: cors })
  }
}
