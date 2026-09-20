import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: cors })
}

/** Stores one file attached to a site note and hands back a URL for it.
 *
 *  Uploaded here rather than straight from the browser so the write doesn't
 *  depend on the storage bucket's row-level policies happening to allow the
 *  signed-in user to write to this prefix — the same reason captured
 *  drawings go through /api/docs/drawing-asset. It also means a failure
 *  comes back as JSON the panel can show, instead of a storage error the
 *  browser swallows.
 *
 *  The bucket is the public observation-photos one the mobile app already
 *  uses, under note-responses/<observation id>/ — deliberately separate from
 *  the site photos at its root, which are what get inserted into reports. */
export async function POST(request: NextRequest) {
  try {
    const observationId = request.nextUrl.searchParams.get('observationId')
    const rawName = request.nextUrl.searchParams.get('name') ?? `file-${Date.now()}`
    if (!observationId) {
      return NextResponse.json({ error: 'Missing observationId' }, { status: 400, headers: cors })
    }

    const contentType = request.headers.get('content-type') || 'application/octet-stream'
    const bytes = Buffer.from(await request.arrayBuffer())
    if (bytes.length === 0) {
      return NextResponse.json({ error: 'The file came through empty' }, { status: 400, headers: cors })
    }

    const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()
    if (!serviceKey) {
      return NextResponse.json({ error: 'Server is missing its storage credentials' }, { status: 500, headers: cors })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
      serviceKey
    )

    // Keep the extension — the browser decides whether it can display a file
    // from it, and the stored name is what the panel offers to download.
    const safeName = rawName.replace(/[^\w.\-]+/g, '_').slice(-80) || `file-${Date.now()}`
    // Timestamped so re-attaching a file of the same name (IMG_0001.jpg,
    // scan.pdf) never overwrites an earlier response.
    const path = `note-responses/${observationId}/${Date.now()}-${safeName}`

    const { error } = await supabase.storage
      .from('observation-photos')
      .upload(path, bytes, { contentType, upsert: false })
    if (error) throw new Error(error.message)

    const url = supabase.storage.from('observation-photos').getPublicUrl(path).data.publicUrl

    console.log('[note-response-file] stored', path, bytes.length, 'bytes')
    return NextResponse.json(
      { url, name: rawName, type: contentType, size: bytes.length },
      { headers: cors }
    )
  } catch (err: any) {
    console.error('[note-response-file] error:', err)
    return NextResponse.json({ error: err.message ?? 'Upload failed' }, { status: 500, headers: cors })
  }
}

/** Removes files that belonged to a deleted response.
 *
 *  Deleting the response row alone left its attachment in the bucket with
 *  nothing recording where it came from — the orphans swept on 2026-09-20
 *  had exactly this shape. Paths are given in the body as `paths`, and each
 *  must sit under the note's own prefix, so this can only ever remove a file
 *  belonging to the note named in the request.
 *
 *  Unlike the upload above, this checks the caller: the note must belong to
 *  a project of their firm. */
export async function DELETE(request: NextRequest) {
  try {
    const { observationId, paths } = await request.json()
    if (!observationId || !Array.isArray(paths) || paths.length === 0) {
      return NextResponse.json({ error: 'Missing observationId or paths' }, { status: 400, headers: cors })
    }

    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401, headers: cors })

    const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
      serviceKey
    )

    const { data: { user } } = await supabase.auth.getUser(token)
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401, headers: cors })

    const { data: note } = await supabase
      .from('observations')
      .select('project_id, inspection_id')
      .eq('id', observationId)
      .single()
    if (!note) return NextResponse.json({ error: 'Site note not found' }, { status: 404, headers: cors })

    let firmId: string | null = null
    if (note.project_id) {
      const { data: p } = await supabase.from('projects').select('firm_id').eq('id', note.project_id).single()
      firmId = p?.firm_id ?? null
    }
    if (!firmId && note.inspection_id) {
      const { data: ins } = await supabase.from('inspections').select('projects(firm_id)').eq('id', note.inspection_id).single()
      firmId = (ins as any)?.projects?.firm_id ?? null
    }

    const { data: member } = await supabase.from('firm_members').select('firm_id').eq('user_id', user.id).single()
    if (!member || !firmId || member.firm_id !== firmId) {
      return NextResponse.json({ error: 'This site note belongs to another firm' }, { status: 403, headers: cors })
    }

    const prefix = `note-responses/${observationId}/`
    const safe = [...new Set((paths as string[]).filter(p => typeof p === 'string' && p.startsWith(prefix)))]
    if (safe.length === 0) {
      return NextResponse.json({ error: 'Those files do not belong to this note' }, { status: 400, headers: cors })
    }

    const { error } = await supabase.storage.from('observation-photos').remove(safe)
    if (error) throw new Error(error.message)

    console.log('[note-response-file] removed', safe.length, 'file(s) for', observationId)
    return NextResponse.json({ success: true, removed: safe.length }, { headers: cors })
  } catch (err: any) {
    console.error('[note-response-file] delete error:', err)
    return NextResponse.json({ error: err.message ?? 'Could not remove the file' }, { status: 500, headers: cors })
  }
}
