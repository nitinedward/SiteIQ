import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'

/**
 * Sketch files — see web/sql/sketches.sql.
 *
 * POST hands out one-time upload links, so the browser uploads straight to
 * storage: a Bluebeam PDF or a scan is easily bigger than the 4.5MB a
 * function will accept, and a plain browser write would depend on the
 * bucket's policies. The paths are chosen here, under
 * sketches/<project>/<new sketch id>/, so a caller can only ever write a
 * new sketch's own files.
 *
 * DELETE removes a sketch's row and its files, which needs the service key.
 *
 * Both require a signed-in member of the firm that owns the project.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co'
const BUCKET = 'observation-photos'
const MAX_PAGES = 50

const admin = () => createClient(
  SUPABASE_URL,
  (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()
)

/** The signed-in user, if they belong to the firm that owns the project. */
async function authorise(request: NextRequest, projectId: string): Promise<{ userId: string } | { error: NextResponse }> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return { error: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) }

  const supabase = admin()
  const { data: { user } } = await supabase.auth.getUser(token)
  if (!user) return { error: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) }

  const [{ data: member }, { data: project }] = await Promise.all([
    supabase.from('firm_members').select('firm_id').eq('user_id', user.id).single(),
    supabase.from('projects').select('firm_id').eq('id', projectId).single(),
  ])
  if (!project) return { error: NextResponse.json({ error: 'Project not found' }, { status: 404 }) }
  if (!member || member.firm_id !== project.firm_id) {
    return { error: NextResponse.json({ error: 'Not a member of this project’s firm' }, { status: 403 }) }
  }
  return { userId: user.id }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** body: { projectId, originalExt, pageCount }
 *  → { sketchId, original: Upload, pages: Upload[] }
 *  where Upload = { path, token, publicUrl }. The page images are PNG. */
export async function POST(request: NextRequest) {
  try {
    const { projectId, originalExt, pageCount } = await request.json()
    if (typeof projectId !== 'string' || !UUID.test(projectId)) {
      return NextResponse.json({ error: 'Missing or invalid projectId' }, { status: 400 })
    }
    const ext = String(originalExt ?? '').toLowerCase()
    if (!['pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      return NextResponse.json({ error: 'Sketches must be a PDF, PNG or JPG' }, { status: 400 })
    }
    const pages = Number(pageCount)
    if (!Number.isInteger(pages) || pages < 0 || pages > MAX_PAGES) {
      return NextResponse.json({ error: `A sketch can have up to ${MAX_PAGES} pages` }, { status: 400 })
    }

    const auth = await authorise(request, projectId)
    if ('error' in auth) return auth.error

    const supabase = admin()
    const sketchId = randomUUID()
    const folder = `sketches/${projectId}/${sketchId}`

    const sign = async (path: string) => {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path)
      if (error || !data) throw new Error('Could not prepare the upload: ' + (error?.message ?? 'unknown error'))
      return {
        path,
        token: data.token,
        publicUrl: supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl,
      }
    }

    const [original, ...pageUploads] = await Promise.all([
      sign(`${folder}/original.${ext}`),
      ...Array.from({ length: pages }, (_, i) => sign(`${folder}/page-${i + 1}.png`)),
    ])

    return NextResponse.json({ sketchId, original, pages: pageUploads })
  } catch (err: any) {
    console.error('[sketches] upload links failed:', err)
    return NextResponse.json({ error: err?.message ?? 'Could not prepare the upload' }, { status: 500 })
  }
}

/** body: { sketchId } — removes the row and every file under its folder. */
export async function DELETE(request: NextRequest) {
  try {
    const { sketchId } = await request.json()
    if (typeof sketchId !== 'string' || !UUID.test(sketchId)) {
      return NextResponse.json({ error: 'Missing or invalid sketchId' }, { status: 400 })
    }

    const supabase = admin()
    const { data: sketch } = await supabase.from('sketches').select('id, project_id').eq('id', sketchId).maybeSingle()
    if (!sketch) return NextResponse.json({ error: 'Sketch not found' }, { status: 404 })

    const auth = await authorise(request, sketch.project_id)
    if ('error' in auth) return auth.error

    // A sketch from a CAN has a hidden drawing companion so it can be marked
    // up on site (web/sql/cans.sql). Markups already made on it belong to an
    // inspection record, so the sketch stays; otherwise the companion goes
    // with it. (No such column before cans.sql runs — then there is none.)
    const { data: companions } = await supabase.from('drawings').select('id').eq('sketch_id', sketch.id)
    const companionIds = (companions ?? []).map((d: any) => d.id as string)
    if (companionIds.length > 0) {
      const { count } = await supabase.from('zones').select('id', { count: 'exact', head: true }).in('drawing_id', companionIds)
      if ((count ?? 0) > 0) {
        return NextResponse.json({
          error: `This sketch has ${count} markup${count === 1 ? '' : 's'} made on site, so it can't be deleted.`,
        }, { status: 409 })
      }
      const { error } = await supabase.from('drawings').delete().in('id', companionIds)
      if (error) throw new Error('Could not remove the on-site copy: ' + error.message)
    }

    // The folder is the record of the files, so nothing is left behind even
    // if the row's own list of pages was incomplete.
    const folder = `sketches/${sketch.project_id}/${sketch.id}`
    const { data: files } = await supabase.storage.from(BUCKET).list(folder, { limit: 200 })
    const paths = (files ?? []).map(f => `${folder}/${f.name}`)
    if (paths.length > 0) {
      const { error } = await supabase.storage.from(BUCKET).remove(paths)
      if (error) console.warn('[sketches] files left behind:', error.message)
    }

    const { error } = await supabase.from('sketches').delete().eq('id', sketch.id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[sketches] delete failed:', err)
    return NextResponse.json({ error: err?.message ?? 'Could not delete the sketch' }, { status: 500 })
  }
}
