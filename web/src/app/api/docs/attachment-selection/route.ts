import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { readAttachmentSelection } from '@/lib/attachmentSelection'
import { drawingAssetStem } from '@/lib/drawingAssetName'

export const dynamic = 'force-dynamic'

/** Which photos and markups the report holds, so the report page opens
 *  with exactly those ticked. See lib/attachmentSelection.
 *
 *  - photos:   URLs, or null when nothing is recorded (the page then ticks
 *              none)
 *  - drawings: the recorded markups whose image is still stored, each with
 *              a signed URL so the page can show it and insert it again
 *              without re-capturing; null when nothing is recorded
 *
 *  `?markups=a,b` signs those markups' stored images instead of the
 *  recorded ones — the page uses it for fresh links just before inserting,
 *  including for a markup it ticked again after it was taken out. */
export async function GET(request: NextRequest) {
  const inspectionId = request.nextUrl.searchParams.get('inspectionId')
  // A UUID and nothing else: it becomes part of the storage paths signed below.
  if (!inspectionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(inspectionId)) {
    return NextResponse.json({ error: 'Missing or invalid inspectionId' }, { status: 400 })
  }

  const selection = await readAttachmentSelection(inspectionId)
  const asked = request.nextUrl.searchParams.get('markups')
  // Re-derived so nothing but a plain stem can reach the storage path.
  const stems = asked !== null
    ? [...new Set(asked.split(',').map(s => drawingAssetStem(s)).filter(Boolean))]
    : selection.drawings

  let drawings: { stem: string; url: string }[] | null = null
  if (stems) {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
      (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()
    )
    const signed = await Promise.all(stems.map(async stem => {
      const { data } = await supabase.storage
        .from('reports')
        .createSignedUrl(`drawing-assets/${inspectionId}/${stem}.png`, 3600)
      return data?.signedUrl ? { stem, url: data.signedUrl } : null
    }))
    drawings = signed.filter((d): d is { stem: string; url: string } => d !== null)
  }

  return NextResponse.json(
    { photos: selection.photos, drawings },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
