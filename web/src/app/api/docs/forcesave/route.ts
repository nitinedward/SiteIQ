import { NextRequest, NextResponse } from 'next/server'
import { forceSaveAndWait } from '@/lib/onlyofficeConvert'

export const dynamic = 'force-dynamic'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: cors })
}

export async function POST(request: NextRequest) {
  try {
    const { key, inspectionId } = await request.json()
    if (!key || !inspectionId) {
      return NextResponse.json({ error: 'Missing key or inspectionId' }, { status: 400, headers: cors })
    }

    // Was previously unsigned — OnlyOffice's local.json has
    // token.enable.request.inbox: true, meaning the Document Server
    // rejects inbound API calls (CommandService.ashx included) without a
    // valid JWT. This was silently failing before.
    const result = await forceSaveAndWait(inspectionId, key)

    return NextResponse.json({ success: true, ...result }, { headers: cors })
  } catch (err: any) {
    console.error('[forcesave] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500, headers: cors })
  }
}
