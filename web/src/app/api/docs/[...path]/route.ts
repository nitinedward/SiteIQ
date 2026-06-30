import { NextRequest, NextResponse } from 'next/server'
import { saveDoc, loadDoc } from '@/lib/docStorage'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS })
}

// GET /api/docs/[inspectionId]
// OnlyOffice calls this to fetch the document for editing
export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const inspectionId = params.path[0]
  if (!inspectionId) {
    return NextResponse.json({ error: 'Missing inspectionId' }, { status: 400 })
  }

  const isDownload = request.nextUrl.searchParams.get('download') === 'true'

  console.log('Doc GET request:', { inspectionId, isDownload })

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

export async function POST(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const inspectionId = params.path[0]

  let body: any = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 0 }, { headers: CORS_HEADERS })
  }

  console.log('[callback] POST received, inspectionId:', inspectionId)
  console.log('[callback] body:', JSON.stringify(body).substring(0, 200))
  console.log('[callback] status:', body.status)

  // Fire-and-forget: start the save but don't await it so the response
  // goes back to OnlyOffice in milliseconds.
  if ((body.status === 2 || body.status === 6) && body.url) {
    saveDocumentInBackground(inspectionId, body.url)
  }

  return NextResponse.json({ error: 0 }, { headers: CORS_HEADERS })
}
