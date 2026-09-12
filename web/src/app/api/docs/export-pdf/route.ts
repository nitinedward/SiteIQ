import { NextRequest, NextResponse } from 'next/server'
import { forceSaveAndWait, convertDocxToPdf } from '@/lib/onlyofficeConvert'
import { reportFileNameFor } from '@/lib/reportFileNameServer'

export const dynamic = 'force-dynamic'
// Force-save (~10s) plus conversion polling (~90s worst case for a large,
// photo-heavy report) can exceed the platform default. Vercel caps this to
// whatever the plan allows, but declaring it costs nothing.
export const maxDuration = 120

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: cors })
}

/** Converts the report's current .docx to PDF and returns the bytes, for
 *  the Download → PDF option.
 *
 *  Deliberately does NOT store the result: a stored PDF is the *frozen*
 *  copy of a finalised report (see finalise-pdf), and an ad-hoc download of
 *  a still-editable report must not be mistaken for one. Finalised reports
 *  don't reach here at all — the client serves those from the frozen PDF.
 *
 *  docKey is optional. When present it matches the key the editor was
 *  opened with, so the live editing session is force-saved first and the
 *  PDF reflects what's on screen rather than the last autosave. */
export async function POST(request: NextRequest) {
  try {
    const { inspectionId, docKey } = await request.json()
    if (!inspectionId) {
      return NextResponse.json({ error: 'Missing inspectionId' }, { status: 400, headers: cors })
    }

    if (docKey) {
      const saveResult = await forceSaveAndWait(inspectionId, docKey)
      console.log('[export-pdf] Force-save result:', saveResult)
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin
    const pdfBuffer = await convertDocxToPdf(inspectionId, appUrl, await reportFileNameFor(inspectionId))
    console.log('[export-pdf] PDF generated, size:', pdfBuffer.length)

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdfBuffer.length),
        'Cache-Control': 'no-store',
      },
    })
  } catch (err: any) {
    console.error('[export-pdf] error:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to export PDF' },
      { status: 500, headers: cors }
    )
  }
}
