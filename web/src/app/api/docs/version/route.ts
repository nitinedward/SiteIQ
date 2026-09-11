import { NextRequest, NextResponse } from 'next/server'
import { getDocVersion, getDocKey } from '@/lib/docStorage'

export const dynamic = 'force-dynamic'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: cors })
}

/** The OnlyOffice document key for the stored report.
 *
 *  The key identifies the *content*, so the page must ask for a new one
 *  after anything rewrites the file (AI generation, inserting attachments)
 *  and open the editor with it. Reusing a key across different content
 *  makes the Document Server serve its cached copy instead of the file —
 *  which is what made an insert appear to reset the report.
 *
 *  `exists: false` means the document hasn't been generated yet. */
export async function GET(request: NextRequest) {
  const inspectionId = request.nextUrl.searchParams.get('inspectionId')
  if (!inspectionId) {
    return NextResponse.json({ error: 'Missing inspectionId' }, { status: 400, headers: cors })
  }

  try {
    const [version, key] = await Promise.all([
      getDocVersion(inspectionId),
      getDocKey(inspectionId),
    ])

    return NextResponse.json(
      {
        exists: !!key,
        key,
        tag: version?.tag ?? null,
        updatedAt: version?.updatedAt ?? null,
        size: version?.size ?? null,
      },
      { headers: { ...cors, 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
    )
  } catch (err: any) {
    console.error('[version] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500, headers: cors })
  }
}
