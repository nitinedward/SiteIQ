import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkTemplate } from '@/lib/templateCheck'

export const dynamic = 'force-dynamic'

/** Reads a stored template and reports what it will do when a report is
 *  generated from it — which placeholders it uses, which look like typos,
 *  and which are missing. Called by the Settings page after an upload. */
export async function POST(request: NextRequest) {
  try {
    const { templateId, fileUrl } = await request.json()
    if (!templateId && !fileUrl) {
      return NextResponse.json({ error: 'Missing templateId' }, { status: 400 })
    }

    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
      key
    )

    let url = fileUrl as string | undefined
    if (templateId) {
      const { data } = await supabase
        .from('report_templates')
        .select('file_url')
        .eq('id', templateId)
        .single()
      if (!data?.file_url) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 })
      }
      url = data.file_url
    }

    const res = await fetch(url!, { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' })
    if (!res.ok) {
      return NextResponse.json({ error: `Could not read the template (${res.status})` }, { status: 502 })
    }

    return NextResponse.json({ success: true, check: checkTemplate(Buffer.from(await res.arrayBuffer())) })
  } catch (err: any) {
    console.error('[template-check] error:', err)
    return NextResponse.json({ error: err.message || 'Could not check the template' }, { status: 500 })
  }
}
