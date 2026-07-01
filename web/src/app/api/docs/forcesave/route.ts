import { NextRequest, NextResponse } from 'next/server'

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
    const { key } = await request.json()
    if (!key) {
      return NextResponse.json({ error: 'Missing key' }, { status: 400, headers: cors })
    }

    const ooUrl = process.env.ONLYOFFICE_SERVER_URL ?? 'http://localhost'
    console.log('[forcesave] Requesting force save, key:', key)

    const res = await fetch(`${ooUrl}/coauthoring/CommandService.ashx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ c: 'forcesave', key }),
    })

    const data = await res.json().catch(() => ({}))
    console.log('[forcesave] OO response:', JSON.stringify(data))

    return NextResponse.json({ success: true, ooResponse: data }, { headers: cors })
  } catch (err: any) {
    console.error('[forcesave] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500, headers: cors })
  }
}
