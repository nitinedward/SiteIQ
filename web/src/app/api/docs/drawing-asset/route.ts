import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: cors })
}

/** Stashes one captured drawing image and hands back a URL for it.
 *
 *  Drawings used to be posted to /api/docs/append inline as base64 data
 *  URLs. A full-page capture is several MB, base64 adds another third, and
 *  a couple of them together exceeded the request body limit — the platform
 *  answered with an HTML "Request Entity Too Large" page, which surfaced as
 *  "Unexpected token 'R' ... is not valid JSON" when the client tried to
 *  parse it. Photos never had this problem because they were always passed
 *  by URL, so drawings now work the same way: upload here as raw binary
 *  (no base64 inflation), then send append just the URL. */
export async function POST(request: NextRequest) {
  try {
    const inspectionId = request.nextUrl.searchParams.get('inspectionId')
    const name = request.nextUrl.searchParams.get('name') ?? `drawing-${Date.now()}`
    if (!inspectionId) {
      return NextResponse.json({ error: 'Missing inspectionId' }, { status: 400, headers: cors })
    }

    const bytes = Buffer.from(await request.arrayBuffer())
    if (bytes.length === 0) {
      return NextResponse.json({ error: 'Empty body' }, { status: 400, headers: cors })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
      (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()
    )

    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60)
    const path = `drawing-assets/${inspectionId}/${safeName}.png`

    const { error } = await supabase.storage
      .from('reports')
      .upload(path, bytes, { contentType: 'image/png', upsert: true })
    if (error) throw new Error('Upload failed: ' + error.message)

    // Signed rather than public: the bucket is private, and only the append
    // route (server-side) needs to read it back.
    const { data: signed, error: signErr } = await supabase.storage
      .from('reports')
      .createSignedUrl(path, 3600)
    if (signErr || !signed?.signedUrl) {
      throw new Error('Could not sign the uploaded drawing')
    }

    console.log('[drawing-asset] stored', path, bytes.length, 'bytes')
    return NextResponse.json({ url: signed.signedUrl, size: bytes.length }, { headers: cors })
  } catch (err: any) {
    console.error('[drawing-asset] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500, headers: cors })
  }
}
