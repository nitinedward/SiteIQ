import { NextRequest, NextResponse } from 'next/server'
import { requireCaller } from '@/lib/apiAuth'
import { admin, BUCKET, ownsPath } from '@/lib/closeoutServer'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Records a PS4 author's newly uploaded signature and removes the one it
 *  replaces. Admins only. */
export async function POST(request: NextRequest) {
  try {
    const { authorId, path } = await request.json()
    const access = await requireCaller(request)
    if (!access.ok) return access.response
    if (access.caller.role !== 'admin') return NextResponse.json({ error: 'Only a firm admin can do this' }, { status: 403 })
    const firmId = access.caller.firmId
    if (typeof authorId !== 'string' || !UUID.test(authorId)) return NextResponse.json({ error: 'Missing or invalid authorId' }, { status: 400 })
    if (!ownsPath(firmId, path) || !path.startsWith(`closeout/${firmId}/signatures/${authorId}-`)) {
      return NextResponse.json({ error: 'Invalid upload path' }, { status: 400 })
    }

    const supabase = admin()
    const { data: author } = await supabase.from('ps4_authors').select('signature_path').eq('id', authorId).eq('firm_id', firmId).maybeSingle()
    if (!author) return NextResponse.json({ error: 'PS4 author not found' }, { status: 404 })
    const { error } = await supabase.from('ps4_authors').update({ signature_path: path }).eq('id', authorId)
    if (error) throw new Error(error.message)
    if (author.signature_path && author.signature_path !== path && ownsPath(firmId, author.signature_path)) {
      await supabase.storage.from(BUCKET).remove([author.signature_path])
    }
    return NextResponse.json({ signature_path: path })
  } catch (err: any) {
    console.error('[closeout/signature] failed:', err)
    return NextResponse.json({ error: err?.message ?? 'Could not save the signature' }, { status: 500 })
  }
}
