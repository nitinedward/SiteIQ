import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAccess } from '@/lib/apiAuth'
import { admin, BUCKET, closeoutPaths, compilePack, pdfSafe } from '@/lib/closeoutServer'
import { PACK_SECTIONS, type CompileRequest, type PackSectionId } from '@/lib/closeout'

export const dynamic = 'force-dynamic'
// Twenty-odd reports to fetch and merge.
export const maxDuration = 300

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SECTION_IDS = new Set<string>(PACK_SECTIONS.map(s => s.id))

/**
 * Puts a DRAFT close-out pack together and stores it (a pack of reports is
 * far bigger than a function may send back), returning short-lived links to
 * view and to download it.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const access = await requireProjectAccess(request, body?.projectId)
    if (!access.ok) return access.response

    const req: CompileRequest = {
      projectId: body.projectId,
      mode: body.mode === 'reports' ? 'reports' : 'ps4',
      sections: (Array.isArray(body.sections) ? body.sections : []).filter((s: unknown): s is PackSectionId => typeof s === 'string' && SECTION_IDS.has(s)),
      reportIds: Array.isArray(body.reportIds) ? body.reportIds.filter((id: unknown) => typeof id === 'string' && UUID.test(id)) : undefined,
      authorId: typeof body.authorId === 'string' && UUID.test(body.authorId) ? body.authorId : undefined,
    }

    const started = Date.now()
    const { bytes, pageCount, warnings } = await compilePack(req, access.caller.firmId)

    const supabase = admin()
    const path = closeoutPaths.draft(access.caller.firmId, req.projectId)
    const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: true })
    if (error) throw new Error('Could not store the pack: ' + error.message)

    const { data: project } = await supabase.from('projects').select('name').eq('id', req.projectId).single()
    const fileName = pdfSafe(`${project?.name ?? 'Project'} - ${req.mode === 'ps4' ? 'PS4 close-out pack' : 'Site reports and registers'} (DRAFT).pdf`).replace(/[\\/:*?"<>|]/g, '-')
    const [view, dl] = await Promise.all([
      supabase.storage.from(BUCKET).createSignedUrl(path, 600),
      supabase.storage.from(BUCKET).createSignedUrl(path, 600, { download: fileName }),
    ])
    console.log('[closeout/compile]', req.projectId, req.mode, '|', pageCount, 'pages |', (bytes.length / 1e6).toFixed(1), 'MB |', Date.now() - started, 'ms')
    return NextResponse.json({ url: view.data?.signedUrl, downloadUrl: dl.data?.signedUrl, pageCount, warnings })
  } catch (err: any) {
    console.error('[closeout/compile] failed:', err)
    return NextResponse.json({ error: err?.message ?? 'Could not put the pack together' }, { status: 500 })
  }
}
