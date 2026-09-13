import { NextRequest, NextResponse } from 'next/server'
import { savePdf, loadMarkupPdf } from '@/lib/docStorage'
import { appendMarkupPages } from '@/lib/appendMarkupPages'
import { forceSaveAndWait, convertDocxToPdf } from '@/lib/onlyofficeConvert'
import { reportFileNameFor } from '@/lib/reportFileNameServer'
import { ensurePdfTitle } from '@/lib/pdfTitle'

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

    // The marked-up drawings go on the end, carrying their own hotspots: a
    // Word document can't express a clickable region over part of an image,
    // so the only way a pin, area or freehand markup links to its photos in
    // the finalised PDF is to append pages that already have those links.
    // Stored by the client just before finalising; absent for a report with
    // no markups, which simply means nothing to append.
    const markup = await loadMarkupPdf(inspectionId).catch(() => null)
    const withMarkup = markup ? await appendMarkupPages(converted, markup) : converted
    if (markup) console.log('[finalise-pdf] Marked-up drawings appended, +', markup.length, 'bytes')

    // Stamped after the append rather than trusting the conversion to have
    // taken the title — this is the copy that gets viewed and emailed.
    const { bytes: pdfBuffer } = await ensurePdfTitle(withMarkup, title)

    await savePdf(inspectionId, pdfBuffer)
    console.log('[finalise-pdf] PDF stored as:', title, 'size:', pdfBuffer.length)

    return NextResponse.json({ success: true, pdfSize: pdfBuffer.length }, { headers: cors })
  } catch (err: any) {
    console.error('[finalise-pdf] error:', err)
    // Never a partial success — the caller must not mark the report
    // finalised if this errors, so a report can't end up "finalised"
    // without a valid PDF.
    return NextResponse.json({ error: err.message || 'Failed to finalise to PDF' }, { status: 500, headers: cors })
  }
}
