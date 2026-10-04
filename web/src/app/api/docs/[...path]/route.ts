import { NextRequest, NextResponse } from 'next/server'
import { saveDoc, loadDoc } from '@/lib/docStorage'
import { requireInspectionAccess, inspectionIdFromDocKey, verifyOnlyOfficeRequest } from '@/lib/apiAuth'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS })
}

// GET /api/docs/[inspectionId]
// The report's .docx. Fetched by:
//  - the Document Server, when the editor isn't given a storage link —
//    it signs the request with the shared secret
//  - the web app's "Download Word", with the user's token
//  - the phone app in the stores (?download=true), with no token — let
//    through only while legacyMobileAllowed() (lib/apiAuth)
export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const inspectionId = params.path[0]
  if (!inspectionId) {
    return NextResponse.json({ error: 'Missing inspectionId' }, { status: 400 })
  }

  const isDownload = request.nextUrl.searchParams.get('download') === 'true'

  if (!verifyOnlyOfficeRequest(request)) {
    const access = await requireInspectionAccess(request, inspectionId, { legacyMobile: isDownload })
    if (!access.ok) return access.response
  }

  try {
    console.log('[download] Request for:', inspectionId, '| isDownload:', isDownload)
    const fileBuffer = await loadDoc(inspectionId)
    console.log('[download] File size:', fileBuffer.length, 'bytes')
    return new NextResponse(new Uint8Array(fileBuffer), {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': isDownload
          ? `attachment; filename="SiteReport_${inspectionId}.docx"`
          : 'inline',
        'Content-Length': fileBuffer.length.toString(),
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      },
    })
  } catch (err) {
    console.error('File not found:', inspectionId, err)
    return NextResponse.json(
      { error: 'Document not found - generate it first' },
      { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } }
    )
  }
}

// POST /api/docs/[inspectionId]
// OnlyOffice calls this when document is saved (status 2 or 6).
// We return { error: 0 } immediately so OO never shows "document could not be saved",
// then save the document in the background.
async function saveDocumentInBackground(inspectionId: string, url: string) {
  try {
    console.log('[callback] Saving doc:', inspectionId, 'from:', url)
    const fileRes = await fetch(url)
    if (!fileRes.ok) {
      console.error('[callback] Fetch from OO failed:', fileRes.status)
      return
    }
    const buffer = Buffer.from(await fileRes.arrayBuffer())
    await saveDoc(inspectionId, buffer)
    console.log('[callback] Saved successfully:', inspectionId)
  } catch (err) {
    console.error('[callback] Save error:', err)
  }
}

/**
 * The Document Server's save callback. Only a callback it signed is acted
 * on — and only what it signed: the body's own status and url are ignored,
 * since without a signature anyone could post "status 2, url: <any file>"
 * and replace the report. The signed key must also be this report's, so a
 * genuine callback for one report can't be replayed against another.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const inspectionId = params.path[0]

  let body: any = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 1 }, { status: 400, headers: CORS_HEADERS })
  }

  const signed = verifyOnlyOfficeRequest(request, body)
  if (!signed) {
    console.warn('[callback] Refused: not signed by the Document Server, inspectionId:', inspectionId)
    return NextResponse.json({ error: 1 }, { status: 401, headers: CORS_HEADERS })
  }
  if (inspectionIdFromDocKey(signed.key) !== inspectionId) {
    console.warn('[callback] Refused: key', signed.key, 'is not for', inspectionId)
    return NextResponse.json({ error: 1 }, { status: 400, headers: CORS_HEADERS })
  }

  console.log('[callback] POST received, inspectionId:', inspectionId)
  console.log('[callback] status:', signed.status)
  console.log('[callback] url:', signed.url)

  // Await the Supabase save before responding so OO knows the file is safe.
  // OO allows up to ~60 s for the callback response; a Supabase upload
  // for a typical report takes well under 10 s.
  if ((signed.status === 2 || signed.status === 6) && signed.url) {
    await saveDocumentInBackground(inspectionId, signed.url)
  }

  return NextResponse.json({ error: 0 }, { headers: CORS_HEADERS })
}
