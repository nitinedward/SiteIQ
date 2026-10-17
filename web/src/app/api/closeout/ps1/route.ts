import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAccess } from '@/lib/apiAuth'
import { overHourlyLimit } from '@/lib/rateLimit'
import { admin, BUCKET, download, ownsPath, readPs1FormFields, readPs1WithClaude } from '@/lib/closeoutServer'
import type { ProjectCloseout, Ps1Reading } from '@/lib/closeout'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

const MAX_PDF_BYTES = 30 * 1024 * 1024

/**
 * Reads a project's newly uploaded design PS1 and keeps what it says in
 * projects.closeout.ps1. The values come straight out of the PS1's fillable
 * boxes when it still has them — exact, and no AI call. A flattened or
 * scanned PS1 is read by Claude instead. Either way nothing is marked
 * checked: the engineer checks each value on the Close-out tab.
 */
export async function POST(request: NextRequest) {
  try {
    const { projectId, path, fileName } = await request.json()
    const access = await requireProjectAccess(request, projectId)
    if (!access.ok) return access.response
    const firmId = access.caller.firmId
    if (!ownsPath(firmId, path) || !path.startsWith(`closeout/${firmId}/projects/${projectId}/ps1-`)) {
      return NextResponse.json({ error: 'Invalid upload path' }, { status: 400 })
    }

    const supabase = admin()
    const { data: project, error: readError } = await supabase.from('projects').select('closeout').eq('id', projectId).single()
    if (readError) throw new Error(/closeout/.test(readError.message) ? 'Run web/sql/closeout.sql in Supabase first.' : readError.message)

    const bytes = await download(path)
    if (bytes.length > MAX_PDF_BYTES) {
      await supabase.storage.from(BUCKET).remove([path])
      return NextResponse.json({ error: 'That PS1 is too large to read (30 MB limit).' }, { status: 413 })
    }

    let reading = await readPs1FormFields(bytes)
    let source: Ps1Reading['source'] = 'form'
    if (!reading) {
      const limited = await overHourlyLimit(request, 'ps1-read', access.caller.userId)
      if (limited) return limited
      try {
        reading = await readPs1WithClaude(bytes)
        source = 'ai'
      } catch (err: any) {
        console.error('[closeout/ps1] AI read failed:', err?.message)
        return NextResponse.json({ error: 'The PS1 could not be read. Check it is the PS1 PDF, or try again.' }, { status: 502 })
      }
    }

    const ps1: Ps1Reading = {
      path,
      fileName: String(fileName ?? 'PS1.pdf').slice(0, 200),
      uploadedAt: new Date().toISOString(),
      source,
      fields: reading.fields,
      legalNA: reading.legalNA,
      checked: {},
    }
    const previous = (project?.closeout ?? {}) as ProjectCloseout
    const closeout: ProjectCloseout = { ...previous, ps1 }
    const { error } = await supabase.from('projects').update({ closeout }).eq('id', projectId)
    if (error) throw new Error(error.message)
    if (previous.ps1?.path && previous.ps1.path !== path && ownsPath(firmId, previous.ps1.path)) {
      await supabase.storage.from(BUCKET).remove([previous.ps1.path])
    }
    console.log('[closeout/ps1]', projectId, '| read from:', source)
    return NextResponse.json({ closeout })
  } catch (err: any) {
    console.error('[closeout/ps1] failed:', err)
    return NextResponse.json({ error: err?.message ?? 'Could not read the PS1' }, { status: 500 })
  }
}
