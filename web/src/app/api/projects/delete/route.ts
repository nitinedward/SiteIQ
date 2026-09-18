import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

/**
 * Deletes a project, everything recorded against it, and the files those
 * rows point at.
 *
 * Done here rather than from the page because the stored files need the
 * service key to remove, and because a half-finished delete should be
 * reported rather than left looking successful. The caller's own token is
 * checked first: only an admin of the firm that owns the project may do it.
 *
 * The database doesn't cascade, so rows go in dependency order.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co'
const serviceKey = () => (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()

/** Storage path out of a public or signed Supabase URL, for one bucket. */
function storagePath(url: string | null | undefined, bucket: string): string | null {
  if (!url) return null
  const m = url.match(new RegExp(`/storage/v1/object/(?:public/|sign/)?${bucket}/([^?]+)`))
  return m ? decodeURIComponent(m[1]) : null
}

async function removeAll(supabase: any, bucket: string, paths: string[]): Promise<number> {
  const unique = [...new Set(paths.filter(Boolean))]
  if (unique.length === 0) return 0
  // Storage removes up to a few hundred at a time comfortably.
  for (let i = 0; i < unique.length; i += 100) {
    const { error } = await supabase.storage.from(bucket).remove(unique.slice(i, i + 100))
    if (error) console.warn(`[delete-project] ${bucket}: ${error.message}`)
  }
  return unique.length
}

export async function POST(request: NextRequest) {
  try {
    const { projectId } = await request.json()
    if (!projectId) return NextResponse.json({ error: 'Missing projectId' }, { status: 400 })

    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    const supabase = createClient(SUPABASE_URL, serviceKey())

    // Who is asking, and are they allowed to delete this project?
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    const [{ data: member }, { data: project }] = await Promise.all([
      supabase.from('firm_members').select('firm_id, role').eq('user_id', user.id).single(),
      supabase.from('projects').select('id, name, firm_id').eq('id', projectId).single(),
    ])
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    if (!member || member.role !== 'admin' || member.firm_id !== project.firm_id) {
      return NextResponse.json({ error: 'Only an admin of this firm can delete the project' }, { status: 403 })
    }

    // ── What belongs to it ────────────────────────────────────────────────
    const [{ data: inspections }, { data: drawings }, { data: notes }] = await Promise.all([
      supabase.from('inspections').select('id, marked_drawing_urls').eq('project_id', projectId),
      supabase.from('drawings').select('id, file_url, preview_url').eq('project_id', projectId),
      supabase.from('observations').select('id, photos').eq('project_id', projectId),
    ])
    const inspectionIds = (inspections ?? []).map((i: any) => i.id)

    const { data: reportNotes } = inspectionIds.length > 0
      ? await supabase.from('observations').select('id, photos').in('inspection_id', inspectionIds)
      : { data: [] as any[] }

    const allNotes = [...(notes ?? []), ...(reportNotes ?? [])]
    const noteIds = [...new Set(allNotes.map((n: any) => n.id))]

    // ── The files those rows point at ─────────────────────────────────────
    const reportPaths: string[] = []
    for (const id of inspectionIds) {
      reportPaths.push(`${id}.docx`, `${id}.pdf`, `${id}-markup.pdf`)
      // Marked-up drawings captured for the report.
      const { data: assets } = await supabase.storage.from('reports').list(`drawing-assets/${id}`, { limit: 200 })
      for (const f of assets ?? []) reportPaths.push(`drawing-assets/${id}/${f.name}`)
      for (const url of (inspections ?? []).find((i: any) => i.id === id)?.marked_drawing_urls ?? []) {
        const p = storagePath(url, 'reports')
        if (p) reportPaths.push(p)
      }
    }

    const drawingPaths = (drawings ?? []).flatMap((d: any) => [
      storagePath(d.file_url, 'drawings'),
      storagePath(d.preview_url, 'drawings'),
    ]).filter(Boolean) as string[]

    const photoPaths: string[] = []
    for (const note of allNotes) {
      const raw = Array.isArray(note.photos) ? note.photos : (() => { try { return JSON.parse(note.photos || '[]') } catch { return [] } })()
      for (const url of raw) {
        const p = storagePath(url, 'observation-photos')
        if (p) photoPaths.push(p)
      }
    }
    // Files attached to a note's responses live under their own prefix.
    for (const noteId of noteIds) {
      const { data: files } = await supabase.storage.from('observation-photos').list(`note-responses/${noteId}`, { limit: 200 })
      for (const f of files ?? []) photoPaths.push(`note-responses/${noteId}/${f.name}`)
    }

    // ── Rows first: a file with no row left is invisible, a row whose file
    //    is gone shows as a broken report. ──────────────────────────────────
    const steps: { what: string; run: () => Promise<{ error: any }> }[] = [
      ...(noteIds.length > 0 ? [{ what: 'note responses', run: async () => await supabase.from('note_responses').delete().in('observation_id', noteIds) }] : []),
      { what: 'site notes', run: async () => await supabase.from('observations').delete().eq('project_id', projectId) },
      ...(inspectionIds.length > 0 ? [
        { what: 'site notes on its reports', run: async () => await supabase.from('observations').delete().in('inspection_id', inspectionIds) },
        { what: 'markups on its reports', run: async () => await supabase.from('zones').delete().in('inspection_id', inspectionIds) },
      ] : []),
      { what: 'drawing markups', run: async () => await supabase.from('zones').delete().eq('project_id', projectId) },
      // The `reports` table holds report content from before reports became
      // Word documents. Its rows still block an inspection from being
      // deleted, which is what made a project refuse to delete at all.
      ...(inspectionIds.length > 0 ? [
        { what: 'stored report content', run: async () => await supabase.from('reports').delete().in('inspection_id', inspectionIds) },
      ] : []),
      { what: 'site reports', run: async () => await supabase.from('inspections').delete().eq('project_id', projectId) },
      { what: 'drawings', run: async () => await supabase.from('drawings').delete().eq('project_id', projectId) },
      { what: 'engineer assignments', run: async () => await supabase.from('project_members').delete().eq('project_id', projectId) },
      { what: 'the project', run: async () => await supabase.from('projects').delete().eq('id', projectId) },
    ]

    for (const step of steps) {
      const { error } = await step.run()
      // note_responses may not exist on an older database; that's not fatal.
      if (error && !/relation .* does not exist|schema cache/i.test(error.message)) {
        return NextResponse.json({ error: `Could not delete ${step.what}: ${error.message}` }, { status: 500 })
      }
    }

    const removed = {
      reports: await removeAll(supabase, 'reports', reportPaths),
      drawings: await removeAll(supabase, 'drawings', drawingPaths),
      photos: await removeAll(supabase, 'observation-photos', photoPaths),
    }
    console.log('[delete-project]', project.name, '| rows cleared | files removed:', removed)

    return NextResponse.json({ success: true, removed })
  } catch (err: any) {
    console.error('[delete-project] error:', err)
    return NextResponse.json({ error: err.message || 'Could not delete the project' }, { status: 500 })
  }
}
