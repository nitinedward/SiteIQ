import { NextRequest, NextResponse } from 'next/server'
import { loadPdf, savePdf } from '@/lib/docStorage'
import { ensurePdfTitle } from '@/lib/pdfTitle'
import { reportFileNameFor } from '@/lib/reportFileNameServer'

export const dynamic = 'force-dynamic'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: cors })
}

/** Gives a stored PDF the report's own name if it isn't carrying it yet,
 *  and keeps the corrected copy so the rewrite happens once per report
 *  rather than once per view. Reports finalised before the title was set
 *  carry the inspection UUID; a renamed report finds its new name here too. */
async function healTitle(pdf: Buffer, inspectionId: string, title: string): Promise<Buffer> {
  const { bytes, changed } = await ensurePdfTitle(pdf, title)
  if (!changed) return pdf

  try {
    await savePdf(inspectionId, bytes)
    console.log('[frozen-pdf] retitled a stored report to:', title)
  } catch (err) {
    // Worth serving the corrected bytes even if we couldn't keep them.
    console.error('[frozen-pdf] retitled but could not store the copy:', err)
  }
  return bytes
}

/** Streams a finalised report's frozen PDF under a human file name.
 *
 *  The page used to point its viewer straight at the Supabase signed URL,
 *  whose object is named `<inspectionId>.pdf` — so the embedded PDF viewer,
 *  and anything saved from it, showed the raw UUID. Supabase's own
 *  `download` option would fix the name but forces an attachment
 *  disposition, which would stop the PDF rendering inline. Serving it here
 *  lets us set `inline` *and* a proper filename.
 *
 *  The file name alone wasn't enough: a viewer prefers the title stored
 *  inside the PDF, and reports finalised before that title was set carry
 *  the inspection UUID there. Those are retitled on the way out and the
 *  corrected copy is stored, so it's a one-off cost per report rather than
 *  per view — see healTitle below. */
export async function GET(request: NextRequest) {
  const inspectionId = request.nextUrl.searchParams.get('inspectionId')
  if (!inspectionId) {
    return NextResponse.json({ error: 'Missing inspectionId' }, { status: 400, headers: cors })
  }

  try {
    const fileName = await reportFileNameFor(inspectionId)

    const stored = await loadPdf(inspectionId)
    const pdf = await healTitle(stored, inspectionId, fileName)

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.length),
        // inline so it still renders in the viewer; the filename is what the
        // viewer displays and what its own download button saves as.
        'Content-Disposition': `inline; filename="${fileName}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err: any) {
    console.error('[frozen-pdf] error:', err)
    return NextResponse.json(
      { error: err.message || 'No frozen PDF for this report' },
      { status: 404, headers: cors }
    )
  }
}
