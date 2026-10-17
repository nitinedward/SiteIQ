import { NextRequest, NextResponse } from 'next/server'
import { requireCaller } from '@/lib/apiAuth'
import { admin, BUCKET, download, inspectPs4Form, ownsPath } from '@/lib/closeoutServer'
import type { FirmPs4Settings } from '@/lib/closeout'

export const dynamic = 'force-dynamic'

/**
 * Records a firm's newly uploaded PS4 form: checks it has the fillable boxes
 * SiteIQ fills (lib/closeout PS4_FIELDS), saves it in firms.ps4_settings and
 * removes the form it replaces. A form missing some boxes is still kept —
 * those boxes just stay blank, and Settings says which.
 */
export async function POST(request: NextRequest) {
  try {
    const { path, fileName } = await request.json()
    const access = await requireCaller(request)
    if (!access.ok) return access.response
    if (access.caller.role !== 'admin') return NextResponse.json({ error: 'Only a firm admin can do this' }, { status: 403 })
    const firmId = access.caller.firmId
    if (!ownsPath(firmId, path) || !path.includes('/ps4-form-')) return NextResponse.json({ error: 'Invalid upload path' }, { status: 400 })

    const supabase = admin()
    let fieldCheck: { found: number; missing: string[] }
    try {
      fieldCheck = await inspectPs4Form(await download(path))
    } catch {
      await supabase.storage.from(BUCKET).remove([path])
      return NextResponse.json({ error: 'That file could not be opened as a PDF.' }, { status: 422 })
    }
    if (fieldCheck.found === 0) {
      await supabase.storage.from(BUCKET).remove([path])
      return NextResponse.json({ error: 'That PDF has no fillable boxes. Upload the fillable ACE NZ / Engineering NZ PS4.' }, { status: 422 })
    }

    const { data: firm, error: readError } = await supabase.from('firms').select('ps4_settings').eq('id', firmId).single()
    if (readError) throw new Error(/ps4_settings/.test(readError.message) ? 'Run web/sql/closeout.sql in Supabase first.' : readError.message)
    const previous = (firm?.ps4_settings ?? {}) as FirmPs4Settings
    const settings: FirmPs4Settings = {
      ...previous,
      formPath: path,
      formName: String(fileName ?? 'PS4.pdf').slice(0, 200),
      uploadedAt: new Date().toISOString(),
      fieldCheck,
    }
    const { error } = await supabase.from('firms').update({ ps4_settings: settings }).eq('id', firmId)
    if (error) throw new Error(error.message)
    if (previous.formPath && previous.formPath !== path && ownsPath(firmId, previous.formPath)) {
      await supabase.storage.from(BUCKET).remove([previous.formPath])
    }
    return NextResponse.json({ settings })
  } catch (err: any) {
    console.error('[closeout/ps4-form] failed:', err)
    return NextResponse.json({ error: err?.message ?? 'Could not save the PS4 form' }, { status: 500 })
  }
}
