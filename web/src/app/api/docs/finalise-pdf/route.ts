import { NextRequest, NextResponse } from 'next/server'
import { savePdf } from '@/lib/docStorage'
import { forceSaveAndWait, convertDocxToPdf } from '@/lib/onlyofficeConvert'

export const dynamic = 'force-dynamic'

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
    const pdfBuffer = await convertDocxToPdf(inspectionId, appUrl)

    await savePdf(inspectionId, pdfBuffer)
    console.log('[finalise-pdf] PDF stored, size:', pdfBuffer.length)

    return NextResponse.json({ success: true, pdfSize: pdfBuffer.length }, { headers: cors })
  } catch (err: any) {
    console.error('[finalise-pdf] error:', err)
    // Never a partial success — the caller must not mark the report
    // finalised if this errors, so a report can't end up "finalised"
    // without a valid PDF.
    return NextResponse.json({ error: err.message || 'Failed to finalise to PDF' }, { status: 500, headers: cors })
  }
}
