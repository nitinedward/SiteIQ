import { NextRequest, NextResponse } from 'next/server'
import { getPdfSignedUrl } from '@/lib/docStorage'
import { requireInspectionAccess } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: cors })
}

/** Returns a fresh signed URL for a report's frozen PDF, or 404 if none
 *  exists — e.g. a report finalised before this feature existed. Callers
 *  should fall back to the read-only editor view in that case. */
export async function GET(request: NextRequest) {
  const inspectionId = request.nextUrl.searchParams.get('inspectionId')
  if (!inspectionId) {
    return NextResponse.json({ error: 'Missing inspectionId' }, { status: 400, headers: cors })
  }
  const access = await requireInspectionAccess(request, inspectionId)
  if (!access.ok) return access.response

  const url = await getPdfSignedUrl(inspectionId)
  if (!url) {
    return NextResponse.json({ error: 'No frozen PDF for this report' }, { status: 404, headers: cors })
  }

  return NextResponse.json({ url }, { headers: cors })
}
