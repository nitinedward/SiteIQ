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
    const fileBuffer = await loadDoc(inspectionId)
    console.log('File found, size:', fileBuffer.length)
    return new NextResponse(new Uint8Array(fileBuffer), {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': isDownload
          ? `attachment; filename="report-${inspectionId}.docx"`
          : 'inline',
        'Content-Length': fileBuffer.length.toString(),
        'Cache-Control': 'no-store',
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
// OnlyOffice calls this when document is saved (status 2 or 6)
export async function POST(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const inspectionId = params.path[0]
  if (!inspectionId) {
    return NextResponse.json({ error: 0 }, { headers: CORS_HEADERS })
  }

  try {
    const body = await request.json()
    console.log('[callback] Received POST', JSON.stringify(body))
    console.log('[callback] Status:', body.status)
    console.log('[callback] URL:', body.url)
    console.log('OnlyOffice callback:', { status: body.status, url: body.url, key: body.key })

    if ((body.status === 2 || body.status === 6) && body.url) {
      try {
        const fileRes = await fetch(body.url)
        if (!fileRes.ok) {
          console.error('Failed to fetch from OO:', body.url)
        } else {
          const fileBuffer = await fileRes.arrayBuffer()
          await saveDoc(inspectionId, Buffer.from(fileBuffer))
          console.log('[storage] OnlyOffice callback saved:', inspectionId)
        }
      } catch (err) {
        console.error('Save error:', err)
      }
    }

    return NextResponse.json({ error: 0 }, { headers: CORS_HEADERS })
  } catch (err) {
    console.error('[docs] POST error:', err)
    return NextResponse.json({ error: 0 }, { headers: CORS_HEADERS })
  }
}
