import { NextRequest, NextResponse } from 'next/server'
import { revokeToken } from '@/lib/microsoftToken'

export async function POST(request: NextRequest) {
  try {
    const { firmId } = await request.json()

    if (!firmId) {
      return NextResponse.json(
        { error: 'Missing firmId' },
        { status: 400 }
      )
    }

    await revokeToken(firmId)

    return NextResponse.json({ success: true })

  } catch (err) {
    console.error('Disconnect error:', err)
    return NextResponse.json(
      { error: 'Failed to disconnect' },
      { status: 500 }
    )
  }
}
