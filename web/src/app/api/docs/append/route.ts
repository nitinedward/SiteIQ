import { NextRequest, NextResponse } from 'next/server'
import { appendAttachments } from '@/lib/appendAttachments'

// Drawings and photos each own a bookmarked section (see
// src/lib/attachmentSections.ts), so one can be rebuilt without disturbing
// the other. A call replaces the sections it was asked for with the CURRENT
// selection rather than only ever adding, so deselecting something and
// re-applying removes it from the document.
//
// `sections` says which to rebuild — omit it to rebuild both, which is what
// the download path wants.
//
// The work itself lives in lib/appendAttachments so a regeneration can
// rebuild the same sections in-process, without calling back into this route
// over HTTP.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (!body?.inspectionId) {
      return NextResponse.json({ error: 'Missing inspectionId' }, { status: 400, headers: corsHeaders })
    }

    const result = await appendAttachments(body)
    return NextResponse.json({ success: true, ...result }, { headers: corsHeaders })
  } catch (err: any) {
    console.error('[append] error:', err)
    const notFound = /Document not found/.test(err?.message ?? '')
    return NextResponse.json(
      { error: err.message || 'Failed to append attachments' },
      { status: notFound ? 404 : 500, headers: corsHeaders }
    )
  }
}
