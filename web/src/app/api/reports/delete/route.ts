import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

/**
 * Deletes one site report: its notes, markups and the files they own.
 *
 * Deleting a report used to clear the rows and leave the Word document, the
 * frozen PDF, the marked-up drawings and every site photo sitting in storage
 * — invisible in the app and still paid for.
 *
 * Runs here rather than from the page because removing stored files needs
 * the service key. The caller's own token is checked first: only someone in
 * the firm that owns the report may delete it.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co'
const serviceKey = () => (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()

function storagePath(url: string | null | undefined, bucket: string): string | null {
  if (!url) return null
  const m = String(url).match(new RegExp(`/storage/v1/object/(?:public/|sign/)?${bucket}/([^?]+)`))
  return m ? decodeURIComponent(m[1]) : null
}

const asArray = (raw: unknown): any[] =>
  Array.isArray(raw) ? raw : (() => { try { return JSON.parse(String(raw ?? '') || '[]') } catch { return [] } })()

async function removeAll(supabase: any, bucket: string, paths: string[]): Promise<number> {
  const unique = [...new Set(paths.filter(Boolean))]
  if (unique.length === 0) return 0
  for (let i = 0; i < unique.length; i += 100) {
    const { error } = await supabase.storage.from(bucket).remove(unique.slice(i, i + 100))
    if (error) console.warn(`[delete-report] ${bucket}: ${error.message}`)
  }
  return unique.length
}

export async function POST(request: NextRequest) {
  try {
    const { inspectionId } = await request.json()
    if (!inspectionId) return NextResponse.json({ error: 'Missing inspectionId' }, { status: 400 })

    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    const supabase = createClient(SUPABASE_URL, serviceKey())

    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    const { data: inspection } = await supabase
      .from('inspections')
      .select('id, project_id, report_no, marked_drawing_urls, projects(firm_id)')
      .eq('id', inspectionId)
      .single()
    if (!inspection) return NextResponse.json({ error: 'Report not found' }, { status: 404 })

    const { data: member } = await supabase
      .from('firm_members')
      .select('firm_id')
      .eq('user_id', user.id)
      .single()
    const firmId = (inspection as any).projects?.firm_id
    if (!member || !firmId || member.firm_id !== firmId) {
      return NextResponse.json({ error: 'This report belongs to another firm' }, { status: 403 })
    }

    // ── What it owns ──────────────────────────────────────────────────────
    const { data: notes } = await supabase
      .from('observations')
      .select('id, photos')
      .eq('inspection_id', inspectionId)
    const noteIds = (notes ?? []).map((n: any) => n.id)

    const photoPaths: string[] = []
    for (const note of notes ?? []) {
      for (const url of asArray((note as any).photos)) {
        const p = storagePath(url, 'observation-photos')
        if (p) photoPaths.push(p)
      }
    }
    for (const noteId of noteIds) {
      const { data: files } = await supabase.storage
        .from('observation-photos')
        .list(`note-responses/${noteId}`, { limit: 200 })
      for (const f of files ?? []) photoPaths.push(`note-responses/${noteId}/${f.name}`)
    }

    const reportPaths = [`${inspectionId}.docx`, `${inspectionId}.pdf`, `${inspectionId}-markup.pdf`]
    const { data: assets } = await supabase.storage
      .from('reports')
      .list(`drawing-assets/${inspectionId}`, { limit: 200 })
    for (const f of assets ?? []) reportPaths.push(`drawing-assets/${inspectionId}/${f.name}`)
    for (const url of (inspection as any).marked_drawing_urls ?? []) {
      const p = storagePath(url, 'reports')
      if (p) reportPaths.push(p)
    }

    // ── Rows first, in dependency order ───────────────────────────────────
    const steps: { what: string; run: () => Promise<{ error: any }> }[] = [
      ...(noteIds.length > 0 ? [{ what: 'note responses', run: async () => await supabase.from('note_responses').delete().in('observation_id', noteIds) }] : []),
      { what: 'site notes', run: async () => await supabase.from('observations').delete().eq('inspection_id', inspectionId) },
      { what: 'markups', run: async () => await supabase.from('zones').delete().eq('inspection_id', inspectionId) },
      // Report content from before reports became Word documents; its rows
      // still block the inspection from being deleted.
      { what: 'stored report content', run: async () => await supabase.from('reports').delete().eq('inspection_id', inspectionId) },
      { what: 'the report', run: async () => await supabase.from('inspections').delete().eq('id', inspectionId) },
    ]

    for (const step of steps) {
      const { error } = await step.run()
      if (error && !/relation .* does not exist|schema cache/i.test(error.message)) {
        return NextResponse.json({ error: `Could not delete ${step.what}: ${error.message}` }, { status: 500 })
      }
    }

    const removed = {
      reports: await removeAll(supabase, 'reports', reportPaths),
      photos: await removeAll(supabase, 'observation-photos', photoPaths),
    }
    console.log('[delete-report]', inspection.report_no, '| rows cleared | files removed:', removed)

    return NextResponse.json({ success: true, removed })
  } catch (err: any) {
    console.error('[delete-report] error:', err)
    return NextResponse.json({ error: err.message || 'Could not delete the report' }, { status: 500 })
  }
}
