import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAccess } from '@/lib/apiAuth'
import { admin } from '@/lib/closeoutServer'
import { PS1_KEYS, type ProjectCloseout, type Ps1Key } from '@/lib/closeout'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined)

/**
 * Saves the Close-out tab's edits to projects.closeout: the consent and
 * amendment numbers, the project's PS4 author, corrections to what was read
 * from the PS1 and which of those details are checked. Only those keys —
 * the PS1 file itself is recorded by /api/closeout/ps1.
 *
 * Through here rather than straight from the page because engineers use the
 * tab too, and the projects table only lets admins write.
 */
export async function POST(request: NextRequest) {
  try {
    const { projectId, patch } = await request.json()
    const access = await requireProjectAccess(request, projectId)
    if (!access.ok) return access.response
    if (!patch || typeof patch !== 'object') return NextResponse.json({ error: 'Nothing to save' }, { status: 400 })

    const supabase = admin()
    const { data: project, error: readError } = await supabase.from('projects').select('closeout').eq('id', projectId).single()
    if (readError) throw new Error(/closeout/.test(readError.message) ? 'Run web/sql/closeout.sql in Supabase first.' : readError.message)
    const closeout: ProjectCloseout = { ...((project?.closeout ?? {}) as ProjectCloseout) }

    if ('consentNo' in patch) closeout.consentNo = str(patch.consentNo, 200) ?? ''
    if ('amendmentNo' in patch) closeout.amendmentNo = str(patch.amendmentNo, 200) ?? ''
    if ('authorId' in patch) {
      if (patch.authorId === null || patch.authorId === '') {
        delete closeout.authorId
      } else {
        if (typeof patch.authorId !== 'string' || !UUID.test(patch.authorId)) return NextResponse.json({ error: 'Invalid authorId' }, { status: 400 })
        const { data: author } = await supabase.from('ps4_authors').select('id').eq('id', patch.authorId).eq('firm_id', access.caller.firmId).maybeSingle()
        if (!author) return NextResponse.json({ error: 'PS4 author not found' }, { status: 404 })
        closeout.authorId = patch.authorId
      }
    }
    if (closeout.ps1) {
      const ps1 = { ...closeout.ps1, fields: { ...closeout.ps1.fields }, checked: { ...closeout.ps1.checked } }
      if (patch.ps1Fields && typeof patch.ps1Fields === 'object') {
        for (const key of PS1_KEYS) {
          const v = str(patch.ps1Fields[key], 4000)
          if (v !== undefined) ps1.fields[key] = v
        }
      }
      if (patch.ps1Checked && typeof patch.ps1Checked === 'object') {
        for (const key of PS1_KEYS) {
          if (typeof patch.ps1Checked[key] === 'boolean') ps1.checked[key as Ps1Key] = patch.ps1Checked[key]
        }
      }
      if (typeof patch.legalNA === 'boolean') ps1.legalNA = patch.legalNA
      closeout.ps1 = ps1
    }

    const { error } = await supabase.from('projects').update({ closeout }).eq('id', projectId)
    if (error) throw new Error(error.message)
    return NextResponse.json({ closeout })
  } catch (err: any) {
    console.error('[closeout/project] failed:', err)
    return NextResponse.json({ error: err?.message ?? 'Could not save' }, { status: 500 })
  }
}
