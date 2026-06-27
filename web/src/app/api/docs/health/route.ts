import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: cors })
}

export async function GET() {
  try {
    const ooUrl = process.env.ONLYOFFICE_SERVER_URL ?? 'http://localhost'
    const res = await fetch(`${ooUrl}/healthcheck`, {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    })
    const text = await res.text()
    return NextResponse.json(
      { healthy: text.trim() === 'true', status: res.status },
      { headers: cors }
    )
  } catch (err: any) {
    return NextResponse.json(
      { healthy: false, error: err.message },
      { headers: cors }
    )
  }
}
