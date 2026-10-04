import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkTemplate } from '@/lib/templateCheck'
import { requireCaller } from '@/lib/apiAuth'
import { fetchFromOurStorage, isOurStorageUrl } from '@/lib/storageFetch'

export const dynamic = 'force-dynamic'

/** Reads a stored template and reports what it will do when a report is
 *  generated from it — which placeholders it uses, which look like typos,
 *  and which are missing. Called by the Settings page after an upload.
 *
 *  Only one of the caller's own firm's templates, looked up by id. It used
 *  to take any `fileUrl` too and fetch it with the service key attached —
 *  which handed the key to whatever server the address named. */
export async function POST(request: NextRequest) {
  try {
    const access = await requireCaller(request)
    if (!access.ok) return access.response

    const { templateId } = await request.json()
    if (!templateId || typeof templateId !== 'string') {
      return NextResponse.json({ error: 'Missing templateId' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
      (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()
    )
    const { data } = await supabase
      .from('report_templates')
      .select('file_url, firm_id')
      .eq('id', templateId)
      .maybeSingle()
    if (!data?.file_url || data.firm_id !== access.caller.firmId) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }
    if (!isOurStorageUrl(data.file_url)) {
      return NextResponse.json({ error: 'This template is stored outside SiteIQ — upload it again' }, { status: 400 })
    }

    const res = await fetchFromOurStorage(data.file_url, { cache: 'no-store' })
    if (!res.ok) {
      return NextResponse.json({ error: `Could not read the template (${res.status})` }, { status: 502 })
    }

    return NextResponse.json({ success: true, check: checkTemplate(Buffer.from(await res.arrayBuffer())) })
  } catch (err: any) {
    console.error('[template-check] error:', err)
    return NextResponse.json({ error: err.message || 'Could not check the template' }, { status: 500 })
  }
}
