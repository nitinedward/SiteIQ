import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { saveMarkupPdf, loadMarkupPdf } from '@/lib/docStorage'
import { reportFileName } from '@/lib/reportFileName'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: cors })
}

async function fileNameFor(inspectionId: string): Promise<string> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
    (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()
  )
  const { data } = await supabase
    .from('inspections')
    .select('*, projects(name)')
    .eq('id', inspectionId)
    .single()

  const custom = ((data as any)?.report_file_name ?? '').trim()
  return custom || reportFileName((data as any)?.projects?.name, (data as any)?.report_no, inspectionId)
}

/** Stores the markup PDF built in the browser. The body is the raw PDF —
 *  it's generated client-side because it needs a canvas both to render the
 *  drawing and to downscale the photos. */
export async function POST(request: NextRequest) {
  try {
    const inspectionId = request.nextUrl.searchParams.get('inspectionId')
    if (!inspectionId) {
      return NextResponse.json({ error: 'Missing inspectionId' }, { status: 400, headers: cors })
    }

    const bytes = Buffer.from(await request.arrayBuffer())
    if (bytes.length === 0) {
      return NextResponse.json({ error: 'Empty body' }, { status: 400, headers: cors })
    }

    await saveMarkupPdf(inspectionId, bytes)
    return NextResponse.json({ success: true, size: bytes.length }, { headers: cors })
  } catch (err: any) {
    console.error('[markup-pdf] save error:', err)
    return NextResponse.json({ error: err.message }, { status: 500, headers: cors })
  }
}

/** Streams the stored markup PDF under a human file name. 404 when the
 *  inspection has no pins — a normal state, not a failure. */
export async function GET(request: NextRequest) {
  const inspectionId = request.nextUrl.searchParams.get('inspectionId')
  if (!inspectionId) {
    return NextResponse.json({ error: 'Missing inspectionId' }, { status: 400, headers: cors })
  }

  try {
    const pdf = await loadMarkupPdf(inspectionId)
    if (!pdf) {
      return NextResponse.json(
        { error: 'No marked-up drawing for this report' },
        { status: 404, headers: cors }
      )
    }

    const name = await fileNameFor(inspectionId)
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.length),
        'Content-Disposition': `inline; filename="${name} - Markup.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err: any) {
    console.error('[markup-pdf] read error:', err)
    return NextResponse.json({ error: err.message }, { status: 500, headers: cors })
  }
}
