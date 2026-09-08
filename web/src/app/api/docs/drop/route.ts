import { NextRequest, NextResponse } from 'next/server'
import { dropEditingSession } from '@/lib/onlyofficeConvert'

export const dynamic = 'force-dynamic'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: cors })
}

/** Ends the open editing session for a document, so the stored file can be
 *  rewritten without the editor flushing its own copy back over the top.
 *  Callers should force-save first — dropping discards anything unsaved. */
export async function POST(request: NextRequest) {
  try {
    const { docKey, userId } = await request.json()
    if (!docKey) {
      return NextResponse.json({ error: 'Missing docKey' }, { status: 400, headers: cors })
    }

    const result = await dropEditingSession(docKey, userId || undefined)
    return NextResponse.json(result, { headers: cors })
  } catch (err: any) {
    console.error('[drop] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500, headers: cors })
  }
}
