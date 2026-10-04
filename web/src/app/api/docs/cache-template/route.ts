import { NextRequest, NextResponse } from 'next/server'
import { clearTemplateCache } from '@/lib/templateProcessor'
import { requireFirmAccess } from '@/lib/apiAuth'

/** Called by the settings page after a new template is uploaded, to bust the
 *  local cache. Only for the caller's own firm. */
export async function POST(request: NextRequest) {
  try {
    const { firmId } = await request.json()
    if (!firmId) {
      return NextResponse.json({ error: 'Missing firmId' }, { status: 400 })
    }
    const access = await requireFirmAccess(request, firmId)
    if (!access.ok) return access.response

    await clearTemplateCache(firmId)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[cache-template] error:', err)
    return NextResponse.json({ error: 'Cache clear failed' }, { status: 500 })
  }
}
