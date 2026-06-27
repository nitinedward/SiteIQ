import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const ooUrl = process.env.ONLYOFFICE_SERVER_URL ?? 'http://localhost'
    const res = await fetch(`${ooUrl}/healthcheck`, {
      signal: AbortSignal.timeout(5000),
    })
    const text = await res.text()
    return NextResponse.json({ healthy: text.trim() === 'true' })
  } catch (err: any) {
    return NextResponse.json({ healthy: false, error: err.message })
  }
}
