import { NextRequest, NextResponse } from 'next/server'
import { revokeToken } from '@/lib/microsoftToken'
import { requireFirmAccess } from '@/lib/apiAuth'

/** Unlinks a firm's Microsoft 365 account — an admin of that firm only. */
export async function POST(request: NextRequest) {
  try {
    const { firmId } = await request.json()

    if (!firmId) {
      return NextResponse.json(
        { error: 'Missing firmId' },
        { status: 400 }
      )
    }
    const access = await requireFirmAccess(request, firmId, { admin: true })
    if (!access.ok) return access.response

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
