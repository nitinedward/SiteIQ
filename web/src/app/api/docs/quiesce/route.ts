import { NextRequest, NextResponse } from 'next/server'
import { quiesceDocument } from '@/lib/quiesceDocument'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: cors })
}

/** Gets a document into a state where it can safely be rewritten — see
 *  src/lib/quiesceDocument.ts for what that involves and why. */
export async function POST(request: NextRequest) {
  try {
    const { inspectionId, docKey, drop = true } = await request.json()
    if (!inspectionId || !docKey) {
      return NextResponse.json({ error: 'Missing inspectionId or docKey' }, { status: 400, headers: cors })
    }

    const result = await quiesceDocument(inspectionId, docKey, drop)
    return NextResponse.json({ success: true, ...result }, { headers: cors })
  } catch (err: any) {
    console.error('[quiesce] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500, headers: cors })
  }
}
