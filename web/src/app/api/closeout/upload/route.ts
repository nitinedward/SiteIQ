import { NextRequest, NextResponse } from 'next/server'
import { requireCaller, requireProjectAccess } from '@/lib/apiAuth'
import { admin, BUCKET, closeoutPaths } from '@/lib/closeoutServer'
import { CLOSEOUT_TEMPLATE_KINDS } from '@/lib/closeout'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A one-time link to upload a close-out file straight to private storage,
 * at a path chosen here — a PS1 or PS4 can be bigger than a function
 * accepts. Each upload gets a fresh path; the route that records it
 * (ps4-form, ps1, or the signature save in Settings) removes the old one.
 *
 *  - ps4form: the firm's PS4 form. Admins only.
 *  - signature: a PS4 author's signature image. Admins only.
 *  - template: the firm's Word layout for a close-out page. Admins only.
 *  - ps1: a project's design PS1. Any member of the project's firm.
 */
export async function POST(request: NextRequest) {
  try {
    const { kind, projectId, authorId, ext, which } = await request.json()
    const stamp = Date.now().toString(36)
    let path: string

    if (kind === 'ps1') {
      const access = await requireProjectAccess(request, projectId)
      if (!access.ok) return access.response
      path = closeoutPaths.ps1(access.caller.firmId, projectId, stamp)
    } else if (kind === 'ps4form' || kind === 'signature' || kind === 'template') {
      const access = await requireCaller(request)
      if (!access.ok) return access.response
      if (access.caller.role !== 'admin') return NextResponse.json({ error: 'Only a firm admin can do this' }, { status: 403 })
      const firmId = access.caller.firmId
      if (kind === 'ps4form') {
        path = closeoutPaths.ps4Form(firmId, stamp)
      } else if (kind === 'template') {
        if (!(CLOSEOUT_TEMPLATE_KINDS as readonly string[]).includes(which)) return NextResponse.json({ error: 'Unknown template' }, { status: 400 })
        path = closeoutPaths.template(firmId, which, stamp)
      } else {
        if (typeof authorId !== 'string' || !UUID.test(authorId)) return NextResponse.json({ error: 'Missing or invalid authorId' }, { status: 400 })
        const { data: author } = await admin().from('ps4_authors').select('id').eq('id', authorId).eq('firm_id', firmId).maybeSingle()
        if (!author) return NextResponse.json({ error: 'PS4 author not found' }, { status: 404 })
        path = closeoutPaths.signature(firmId, authorId, stamp, ext === 'jpg' ? 'jpg' : 'png')
      }
    } else {
      return NextResponse.json({ error: 'Unknown upload kind' }, { status: 400 })
    }

    const { data, error } = await admin().storage.from(BUCKET).createSignedUploadUrl(path)
    if (error || !data) throw new Error('Could not prepare the upload: ' + (error?.message ?? 'unknown error'))
    return NextResponse.json({ path, token: data.token })
  } catch (err: any) {
    console.error('[closeout/upload] failed:', err)
    return NextResponse.json({ error: err?.message ?? 'Could not prepare the upload' }, { status: 500 })
  }
}
