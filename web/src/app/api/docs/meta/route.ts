import { NextRequest, NextResponse } from 'next/server'
import { setDocumentMeta } from '@/lib/onlyofficeConvert'

export const dynamic = 'force-dynamic'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: cors })
}

/** Updates the title shown by an open editing session, so a rename made
 *  from the editor's title bar sticks instead of snapping back to the name
 *  the document was opened with. The new name is persisted by the caller
 *  first; this only refreshes what the editor displays. */
export async function POST(request: NextRequest) {
  try {
    const { docKey, title } = await request.json()
    if (!docKey || !title) {
      return NextResponse.json({ error: 'Missing docKey or title' }, { status: 400, headers: cors })
    }

    const result = await setDocumentMeta(docKey, title)
    console.log('[meta] result:', JSON.stringify(result.response))
    return NextResponse.json(result, { headers: cors })
  } catch (err: any) {
    console.error('[meta] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500, headers: cors })
  }
}
