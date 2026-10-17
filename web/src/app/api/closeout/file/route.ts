import { NextRequest, NextResponse } from 'next/server'
import { requireCaller, requireProjectAccess } from '@/lib/apiAuth'
import { admin, BUCKET, ownsPath } from '@/lib/closeoutServer'
import type { CloseoutTemplateKind, FirmPs4Settings, ProjectCloseout } from '@/lib/closeout'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A ten-minute link to view a close-out file kept in private storage:
 * ?kind=ps1&projectId=…, ?kind=ps4form, ?kind=signature&authorId=…, or
 * ?kind=template&which=summary|noteReg
 * The path is looked up from the record, never taken from the caller.
 */
export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams
    const kind = q.get('kind')
    const supabase = admin()
    let path: string | null | undefined
    let firmId: string

    if (kind === 'ps1') {
      const projectId = q.get('projectId')
      const access = await requireProjectAccess(request, projectId)
      if (!access.ok) return access.response
      firmId = access.caller.firmId
      const { data } = await supabase.from('projects').select('closeout').eq('id', projectId!).single()
      path = ((data?.closeout ?? {}) as ProjectCloseout).ps1?.path
    } else {
      const access = await requireCaller(request)
      if (!access.ok) return access.response
      firmId = access.caller.firmId
      if (kind === 'ps4form') {
        const { data } = await supabase.from('firms').select('ps4_settings').eq('id', firmId).single()
        path = ((data?.ps4_settings ?? {}) as FirmPs4Settings).formPath
      } else if (kind === 'template') {
        const which = q.get('which') as CloseoutTemplateKind
        const { data } = await supabase.from('firms').select('ps4_settings').eq('id', firmId).single()
        path = ((data?.ps4_settings ?? {}) as FirmPs4Settings).templates?.[which]?.path
      } else if (kind === 'signature') {
        const authorId = q.get('authorId')
        if (!authorId || !UUID.test(authorId)) return NextResponse.json({ error: 'Missing or invalid authorId' }, { status: 400 })
        const { data } = await supabase.from('ps4_authors').select('signature_path').eq('id', authorId).eq('firm_id', firmId).maybeSingle()
        path = data?.signature_path
      } else {
        return NextResponse.json({ error: 'Unknown file kind' }, { status: 400 })
      }
    }

    if (!ownsPath(firmId, path)) return NextResponse.json({ error: 'No file' }, { status: 404 })
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600)
    if (error || !data) return NextResponse.json({ error: 'No file' }, { status: 404 })
    return NextResponse.json({ url: data.signedUrl })
  } catch (err: any) {
    console.error('[closeout/file] failed:', err)
    return NextResponse.json({ error: err?.message ?? 'Could not open the file' }, { status: 500 })
  }
}
