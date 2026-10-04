import { NextRequest, NextResponse } from 'next/server'
import { readPhotoSelection } from '@/lib/photoSelection'

export const dynamic = 'force-dynamic'

/** Which photos the report holds, so the report page opens with exactly
 *  those ticked. `photos` is null when nothing has been recorded yet (a new
 *  report, or one from before selections were recorded) — the page then
 *  starts with none ticked. See lib/photoSelection. */
export async function GET(request: NextRequest) {
  const inspectionId = request.nextUrl.searchParams.get('inspectionId')
  if (!inspectionId) {
    return NextResponse.json({ error: 'Missing inspectionId' }, { status: 400 })
  }
  const photos = await readPhotoSelection(inspectionId)
  return NextResponse.json({ photos }, { headers: { 'Cache-Control': 'no-store' } })
}
