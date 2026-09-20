import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

/**
 * Deletes one site note, its responses, and the files both point at.
 *
 * Deleting a project or a report already cleaned up after itself; deleting a
 * single note did not — it removed the row straight from the app and left
 * its photos and response attachments in the bucket for good, because once
 * the row is gone nothing records where its files were. That is where the
 * orphans swept on 2026-09-20 came from.
 *
 * Here rather than in the app because removing stored files needs the
 * service key. The caller's own token is checked first: the note must belong
 * to a project of the caller's firm.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co'
const serviceKey = () => (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()

/** Storage path out of a public or signed Supabase URL, for one bucket. */
function storagePath(url: string | null | undefined, bucket: string): string | null {
  if (!url) return null
  const m = url.match(new RegExp(`/storage/v1/object/(?:public/|sign/)?${bucket}/([^?]+)`))
  return m ? decodeURIComponent(m[1]) : null
}

function asArray(photos: any): string[] {
  if (Array.isArray(photos)) return photos
  try { return JSON.parse(photos || '[]') } catch { return [] }
}

export async function POST(request: NextRequest) {
  try {
    const { observationId } = await request.json()
    if (!observationId) return NextResponse.json({ error: 'Missing observationId' }, { status: 400 })

    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    const supabase = createClient(SUPABASE_URL, serviceKey())

    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    const { data: note } = await supabase
      .from('observations')
      .select('id, photos, project_id, inspection_id')
      .eq('id', observationId)
      .single()
    if (!note) return NextResponse.json({ error: 'Site note not found' }, { status: 404 })

    // Which firm owns it — a note hangs off a project directly, or off the
    // report it was recorded on.
    let firmId: string | null = null
    if (note.project_id) {
      const { data: p } = await supabase.from('projects').select('firm_id').eq('id', note.project_id).single()
      firmId = p?.firm_id ?? null
    }
    if (!firmId && note.inspection_id) {
      const { data: ins } = await supabase
        .from('inspections')
        .select('projects(firm_id)')
        .eq('id', note.inspection_id)
        .single()
      firmId = (ins as any)?.projects?.firm_id ?? null
    }

    const { data: member } = await supabase
      .from('firm_members')
      .select('firm_id')
      .eq('user_id', user.id)
      .single()
    if (!member || !firmId || member.firm_id !== firmId) {
      return NextResponse.json({ error: 'This site note belongs to another firm' }, { status: 403 })
    }

    // ── The files it points at, found before the row goes ─────────────────
    const photoPaths = asArray(note.photos)
      .map((url: string) => storagePath(url, 'observation-photos'))
      .filter(Boolean) as string[]

    const { data: responseFiles } = await supabase.storage
      .from('observation-photos')
      .list(`note-responses/${observationId}`, { limit: 200 })
    for (const f of responseFiles ?? []) photoPaths.push(`note-responses/${observationId}/${f.name}`)

    // ── Rows first: a file with no row left is invisible, a row whose file
    //    is gone shows as a broken photo. ─────────────────────────────────
    const { error: responsesError } = await supabase.from('note_responses').delete().eq('observation_id', observationId)
    // note_responses may not exist on an older database; that's not fatal.
    if (responsesError && !/relation .* does not exist|schema cache/i.test(responsesError.message)) {
      return NextResponse.json({ error: `Could not delete the note's responses: ${responsesError.message}` }, { status: 500 })
    }

    const { error: noteError } = await supabase.from('observations').delete().eq('id', observationId)
    if (noteError) return NextResponse.json({ error: `Could not delete the site note: ${noteError.message}` }, { status: 500 })

    const unique = [...new Set(photoPaths)]
    if (unique.length > 0) {
      const { error } = await supabase.storage.from('observation-photos').remove(unique)
      if (error) console.warn('[delete-note] observation-photos:', error.message)
    }
    console.log('[delete-note]', observationId, '| files removed:', unique.length)

    return NextResponse.json({ success: true, removed: unique.length })
  } catch (err: any) {
    console.error('[delete-note] error:', err)
    return NextResponse.json({ error: err.message || 'Could not delete the site note' }, { status: 500 })
  }
}
