import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { requireProjectAccess } from '@/lib/apiAuth'
import { supabaseUrl } from '@/lib/storageFetch'

export const dynamic = 'force-dynamic'

/**
 * CAN files — see web/sql/cans.sql.
 *
 * POST hands out a one-time link to upload a CAN's PDF straight to storage
 * (a CAN with sketches is easily bigger than a function accepts), at a path
 * chosen here: cans/<project>/<new CAN id>/original.pdf.
 *
 * DELETE removes a CAN, its sketches and their on-site companions, and the
 * files — unless markups were already made on site against those sketches,
 * which are part of an inspection record: then it is refused, and the CAN
 * can be superseded by a new revision instead.
 *
 * Both for a signed-in member of the project's firm only.
 */

const BUCKET = 'observation-photos'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const admin = () => createClient(supabaseUrl(), (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim())

export async function POST(request: NextRequest) {
  try {
    const { projectId } = await request.json()
    const access = await requireProjectAccess(request, projectId)
    if (!access.ok) return access.response

    const supabase = admin()
    const canId = randomUUID()
    const path = `cans/${projectId}/${canId}/original.pdf`
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path)
    if (error || !data) throw new Error('Could not prepare the upload: ' + (error?.message ?? 'unknown error'))

    return NextResponse.json({
      canId,
      upload: { path, token: data.token, publicUrl: supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl },
    })
  } catch (err: any) {
    console.error('[cans] upload link failed:', err)
    return NextResponse.json({ error: err?.message ?? 'Could not prepare the upload' }, { status: 500 })
  }
}

async function removeFolder(supabase: ReturnType<typeof admin>, folder: string) {
  const { data: files } = await supabase.storage.from(BUCKET).list(folder, { limit: 200 })
  const paths = (files ?? []).map(f => `${folder}/${f.name}`)
  if (paths.length > 0) {
    const { error } = await supabase.storage.from(BUCKET).remove(paths)
    if (error) console.warn('[cans] files left behind in', folder, error.message)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { canId, projectId, unfiled } = await request.json()
    if (typeof canId !== 'string' || !UUID.test(canId)) {
      return NextResponse.json({ error: 'Missing or invalid canId' }, { status: 400 })
    }

    const supabase = admin()
    const { data: can } = await supabase.from('cans').select('id, project_id, number, revision').eq('id', canId).maybeSingle()

    // A review that was cancelled: the PDF was uploaded but never filed, so
    // there is no row to look the project up from — the caller names it.
    if (!can && unfiled) {
      const access = await requireProjectAccess(request, projectId)
      if (!access.ok) return access.response
      await removeFolder(supabase, `cans/${projectId}/${canId}`)
      return NextResponse.json({ success: true })
    }
    if (!can) return NextResponse.json({ error: 'CAN not found' }, { status: 404 })

    const access = await requireProjectAccess(request, can.project_id)
    if (!access.ok) return access.response

    const { data: sketches } = await supabase.from('sketches').select('id').eq('can_id', can.id)
    const sketchIds = (sketches ?? []).map((s: any) => s.id as string)
    const { data: companions } = sketchIds.length
      ? await supabase.from('drawings').select('id').in('sketch_id', sketchIds)
      : { data: [] as any[] }
    const drawingIds = (companions ?? []).map((d: any) => d.id as string)

    if (drawingIds.length > 0) {
      const { count } = await supabase.from('zones').select('id', { count: 'exact', head: true }).in('drawing_id', drawingIds)
      if ((count ?? 0) > 0) {
        return NextResponse.json({
          error: `${can.number} has ${count} markup${count === 1 ? '' : 's'} made on site against its sketches, so it can't be deleted. Upload a new revision to supersede it instead.`,
        }, { status: 409 })
      }
      const { error } = await supabase.from('drawings').delete().in('id', drawingIds)
      if (error) throw new Error('Could not remove its on-site sketches: ' + error.message)
    }

    for (const id of sketchIds) await removeFolder(supabase, `sketches/${can.project_id}/${id}`)
    if (sketchIds.length > 0) {
      const { error } = await supabase.from('sketches').delete().in('id', sketchIds)
      if (error) throw new Error('Could not remove its sketches: ' + error.message)
    }

    // If this revision superseded an earlier one, that one is current again.
    await supabase.from('cans').update({ status: 'current', superseded_by: null }).eq('superseded_by', can.id)

    await removeFolder(supabase, `cans/${can.project_id}/${can.id}`)
    const { error } = await supabase.from('cans').delete().eq('id', can.id)
    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[cans] delete failed:', err)
    return NextResponse.json({ error: err?.message ?? 'Could not delete the CAN' }, { status: 500 })
  }
}
