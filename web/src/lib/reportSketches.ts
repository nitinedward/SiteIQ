import { createClient } from '@supabase/supabase-js'
import { supabaseUrl } from '@/lib/storageFetch'

/**
 * The sketches that belong to a report, server-side (service role).
 *
 * A sketch belongs to report R when its site note is one of R's notes, or
 * when it has no note and was added to R ("General"). See web/sql/sketches.sql.
 *
 * Ordered the way the report reads: by site note, in the order the report
 * lists its notes (observations by id — the same order the written sections
 * and the photos use), General last, then oldest first. `noteNumber` is the
 * note's position in that order, which is how captions say "site note 2".
 */

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
  (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()
)

export type SketchPage = { url: string; width: number; height: number }

export type ReportSketch = {
  id: string
  title: string
  observationId: string | null
  noteLabel: string | null
  noteNumber: number | null
  fileUrl: string
  fileName: string | null
  pages: SketchPage[]
  createdAt: string
}

/** Where sketch files may live. Anything else in a row is ignored, so a
 *  tampered row can't make the server fetch another address. */
export function isSketchFileUrl(url: string): boolean {
  const base = supabaseUrl()
  return url.startsWith(`${base}/storage/v1/object/public/observation-photos/sketches/`)
}

function asPages(raw: unknown): SketchPage[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((p: any) => typeof p?.url === 'string' && isSketchFileUrl(p.url))
    .map((p: any) => ({ url: p.url, width: Number(p.width) || 0, height: Number(p.height) || 0 }))
}

/** Every sketch in the report, in report order. An empty list when there
 *  are none — or when the sketches table hasn't been created yet. */
export async function loadReportSketches(inspectionId: string): Promise<ReportSketch[]> {
  const supabase = getSupabase()

  const { data: notes } = await supabase
    .from('observations')
    .select('id, zone_label')
    .eq('inspection_id', inspectionId)
    .order('id', { ascending: true })

  const noteIds = (notes ?? []).map((n: any) => n.id as string)
  const position = new Map(noteIds.map((id, i) => [id, i]))

  let query = supabase.from('sketches').select('*')
  query = noteIds.length > 0
    ? query.or(`inspection_id.eq.${inspectionId},observation_id.in.(${noteIds.join(',')})`)
    : query.eq('inspection_id', inspectionId)
  const { data: rows, error } = await query
  if (error) {
    // Most likely the table not existing yet — a report without sketches.
    console.warn('[sketches] could not load:', error.message)
    return []
  }

  const labelOf = new Map((notes ?? []).map((n: any) => [n.id as string, (n.zone_label as string) || 'General Observation']))

  return (rows ?? [])
    // A sketch linked to a note in another report belongs to that report,
    // even if it was first added here; only an unlinked one is General here.
    .filter((r: any) => !r.observation_id || position.has(r.observation_id))
    .map((r: any): ReportSketch => {
      const linked = !!r.observation_id
      return {
        id: r.id,
        title: r.title ?? '',
        observationId: linked ? r.observation_id : null,
        noteLabel: linked ? labelOf.get(r.observation_id) ?? null : null,
        noteNumber: linked ? (position.get(r.observation_id)! + 1) : null,
        fileUrl: r.file_url,
        fileName: r.file_name ?? null,
        pages: asPages(r.pages),
        createdAt: r.created_at,
      }
    })
    .sort((a, b) =>
      (a.noteNumber ?? Infinity) - (b.noteNumber ?? Infinity) ||
      a.createdAt.localeCompare(b.createdAt)
    )
}

/** The caption lines for the nth sketch in the report (1-based). */
export function sketchCaption(sketch: ReportSketch, n: number): { heading: string; ref: string } {
  const title = sketch.title.trim()
  return {
    heading: `Sketch S${n}${title ? ` — ${title}` : ''}`,
    ref: sketch.noteNumber
      ? `Site note ${sketch.noteNumber}: ${sketch.noteLabel}`
      : 'General',
  }
}
