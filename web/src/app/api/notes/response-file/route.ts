import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: cors })
}

/** Stores one file attached to a site note and hands back a URL for it.
 *
 *  Uploaded here rather than straight from the browser so the write doesn't
 *  depend on the storage bucket's row-level policies happening to allow the
 *  signed-in user to write to this prefix — the same reason captured
 *  drawings go through /api/docs/drawing-asset. It also means a failure
 *  comes back as JSON the panel can show, instead of a storage error the
 *  browser swallows.
 *
 *  The bucket is the public observation-photos one the mobile app already
 *  uses, under note-responses/<observation id>/ — deliberately separate from
 *  the site photos at its root, which are what get inserted into reports. */
export async function POST(request: NextRequest) {
  try {
    const observationId = request.nextUrl.searchParams.get('observationId')
    const rawName = request.nextUrl.searchParams.get('name') ?? `file-${Date.now()}`
    if (!observationId) {
      return NextResponse.json({ error: 'Missing observationId' }, { status: 400, headers: cors })
    }

    const contentType = request.headers.get('content-type') || 'application/octet-stream'
    const bytes = Buffer.from(await request.arrayBuffer())
    if (bytes.length === 0) {
      return NextResponse.json({ error: 'The file came through empty' }, { status: 400, headers: cors })
    }

    const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()
    if (!serviceKey) {
      return NextResponse.json({ error: 'Server is missing its storage credentials' }, { status: 500, headers: cors })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
      serviceKey
    )

    // Keep the extension — the browser decides whether it can display a file
    // from it, and the stored name is what the panel offers to download.
    const safeName = rawName.replace(/[^\w.\-]+/g, '_').slice(-80) || `file-${Date.now()}`
    // Timestamped so re-attaching a file of the same name (IMG_0001.jpg,
    // scan.pdf) never overwrites an earlier response.
    const path = `note-responses/${observationId}/${Date.now()}-${safeName}`

    const { error } = await supabase.storage
      .from('observation-photos')
      .upload(path, bytes, { contentType, upsert: false })
    if (error) throw new Error(error.message)

    const url = supabase.storage.from('observation-photos').getPublicUrl(path).data.publicUrl

    console.log('[note-response-file] stored', path, bytes.length, 'bytes')
    return NextResponse.json(
      { url, name: rawName, type: contentType, size: bytes.length },
      { headers: cors }
    )
  } catch (err: any) {
    console.error('[note-response-file] error:', err)
    return NextResponse.json({ error: err.message ?? 'Upload failed' }, { status: 500, headers: cors })
  }
}
