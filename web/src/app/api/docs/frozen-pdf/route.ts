import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { loadPdf } from '@/lib/docStorage'
import { reportFileName } from '@/lib/reportFileName'

export const dynamic = 'force-dynamic'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: cors })
}

/** Streams a finalised report's frozen PDF under a human file name.
 *
 *  The page used to point its viewer straight at the Supabase signed URL,
 *  whose object is named `<inspectionId>.pdf` — so the embedded PDF viewer,
 *  and anything saved from it, showed the raw UUID. Supabase's own
 *  `download` option would fix the name but forces an attachment
 *  disposition, which would stop the PDF rendering inline. Serving it here
 *  lets us set `inline` *and* a proper filename. */
export async function GET(request: NextRequest) {
  const inspectionId = request.nextUrl.searchParams.get('inspectionId')
  if (!inspectionId) {
    return NextResponse.json({ error: 'Missing inspectionId' }, { status: 400, headers: cors })
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
      (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()
    )
    // select('*') rather than naming columns, so this keeps working whether
    // or not the optional report_file_name column exists yet.
    const { data: inspection } = await supabase
      .from('inspections')
      .select('*, projects(name)')
      .eq('id', inspectionId)
      .single()

    const custom = ((inspection as any)?.report_file_name ?? '').trim()
    const projectName = (inspection as any)?.projects?.name as string | undefined
    const fileName = custom || reportFileName(projectName, (inspection as any)?.report_no, inspectionId)

    const pdf = await loadPdf(inspectionId)

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.length),
        // inline so it still renders in the viewer; the filename is what the
        // viewer displays and what its own download button saves as.
        'Content-Disposition': `inline; filename="${fileName}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err: any) {
    console.error('[frozen-pdf] error:', err)
    return NextResponse.json(
      { error: err.message || 'No frozen PDF for this report' },
      { status: 404, headers: cors }
    )
  }
}
