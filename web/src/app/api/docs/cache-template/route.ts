import { NextRequest, NextResponse } from 'next/server'
import { clearTemplateCache } from '@/lib/templateProcessor'

/** Called by the settings page after a new template is uploaded, to bust the local cache. */
export async function POST(request: NextRequest) {
  try {
    const { firmId } = await request.json()
    if (!firmId) {
      return NextResponse.json({ error: 'Missing firmId' }, { status: 400 })
    }
    await clearTemplateCache(firmId)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[cache-template] error:', err)
    return NextResponse.json({ error: 'Cache clear failed' }, { status: 500 })
  }
}
