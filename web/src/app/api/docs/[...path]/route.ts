import { NextRequest, NextResponse } from 'next/server'
import { writeFile, readFile, mkdir } from 'fs/promises'
import path from 'path'
import os from 'os'

function tmpPath(inspectionId: string) {
  return path.join(os.tmpdir(), 'siteiq-docs', `${inspectionId}.docx`)
}

// GET /api/docs/[inspectionId]
// OnlyOffice calls this to fetch the document for editing
export async function GET(
  _request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const inspectionId = params.path[0]
  if (!inspectionId) {
    return NextResponse.json({ error: 'Missing inspectionId' }, { status: 400 })
  }

  try {
    const fileBuffer = await readFile(tmpPath(inspectionId))
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type':        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="report-${inspectionId}.docx"`,
        'Cache-Control':       'no-store',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
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
    return NextResponse.json({ error: 0 })
  }

  try {
    const body = await request.json()

    // Status 2 = ready for saving, 6 = force-saved
    if ((body.status === 2 || body.status === 6) && body.url) {
      const fileRes = await fetch(body.url)
      if (fileRes.ok) {
        const fileBuffer = await fileRes.arrayBuffer()
        const dir = path.join(os.tmpdir(), 'siteiq-docs')
        await mkdir(dir, { recursive: true })
        await writeFile(tmpPath(inspectionId), Buffer.from(fileBuffer))
        console.log(`[docs] Saved document for inspection: ${inspectionId}`)
      }
    }

    // OnlyOffice requires exactly { error: 0 } to acknowledge receipt
    return NextResponse.json({ error: 0 })
  } catch (err) {
    console.error('[docs] POST error:', err)
    return NextResponse.json({ error: 0 })
  }
}
