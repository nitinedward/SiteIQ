import { supabase } from '@/lib/supabase'

/** A site note is an observation recorded on site: what the engineer
 *  dictated, the photos they took, anything they measured, and the pin they
 *  dropped on a drawing. The mobile app tracks each one as open or closed. */

export type NoteStatus = 'OPEN' | 'CLOSED'

export type NoteMeasurement = { type?: string; label?: string; value: string; unit: string }

export type NoteZone = {
  id: string
  label: string
  x_percent: number
  y_percent: number
  markup_type: 'pin' | 'rectangle' | 'freehand'
  shape_data: string | null
  drawing_id: string | null
}

export type NoteDrawing = {
  id: string
  title: string
  number: string
  revision: string
  file_url: string
}

export type SiteNote = {
  id: string
  status: NoteStatus
  zoneLabel: string
  description: string
  photos: string[]
  measurements: NoteMeasurement[]
  observedAt: string | null
  inspectionId: string | null
  reportNo: string | null
  visitDate: string | null
  zone: NoteZone | null
  drawing: NoteDrawing | null
}

/** Observations are stored open/closed in the `severity` column. Ones
 *  recorded before that change hold a severity grade instead, so only an
 *  explicit 'CLOSED' counts as closed — everything else is still open.
 *
 *  In particular 'NONE' is NOT treated as closed: it was the pre-selected
 *  first chip of the old severity picker, so it means nobody set a grade,
 *  not that the item was resolved. Most historic observations carry it, and
 *  reading them as closed would mark the whole back catalogue resolved.
 *
 *  Kept identical to the mobile app's toStatus() in app/observation.tsx. */
export function noteStatus(stored: string | null | undefined): NoteStatus {
  return String(stored ?? '').toUpperCase() === 'CLOSED' ? 'CLOSED' : 'OPEN'
}

/** Columns arrive as a JSON array, a JSON string, or an object depending on
 *  how the row was written — the mobile app has used all three over time. */
function asArray<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[]
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw || '[]')
      return Array.isArray(parsed) ? parsed : []
    } catch { return [] }
  }
  if (raw && typeof raw === 'object') return Object.values(raw) as T[]
  return []
}

export function measurementLabel(m: NoteMeasurement): string {
  return m.label || m.type || 'Measurement'
}

/** Every site note on a project, newest first, with the visit it came from
 *  and the drawing pin it belongs to. */
export async function loadProjectSiteNotes(projectId: string): Promise<SiteNote[]> {
  const { data: inspections } = await supabase
    .from('inspections')
    .select('id, report_no, date, created_at')
    .eq('project_id', projectId)

  const inspectionIds = (inspections ?? []).map((i: any) => i.id)

  // Two lookups rather than one: an observation carries both a project_id
  // and an inspection_id, but general observations recorded outside a visit
  // have no inspection, and some older rows have no project_id. Taking both
  // and merging on id means neither kind goes missing.
  const [byProject, byInspection] = await Promise.all([
    supabase.from('observations').select('*').eq('project_id', projectId),
    inspectionIds.length > 0
      ? supabase.from('observations').select('*').in('inspection_id', inspectionIds)
      : Promise.resolve({ data: [] as any[] }),
  ])

  const rows = new Map<string, any>()
  for (const row of [...((byProject as any).data ?? []), ...((byInspection as any).data ?? [])]) {
    rows.set(row.id, row)
  }
  if (rows.size === 0) return []

  const zoneIds = [...new Set([...rows.values()].map(r => r.zone_id).filter(Boolean))]
  const { data: zones } = zoneIds.length > 0
    ? await supabase.from('zones').select('*').in('id', zoneIds)
    : { data: [] as any[] }

  const drawingIds = [...new Set((zones ?? []).map((z: any) => z.drawing_id).filter(Boolean))]
  const { data: drawings } = drawingIds.length > 0
    ? await supabase.from('drawings').select('id, title, number, revision, file_url').in('id', drawingIds)
    : { data: [] as any[] }

  const inspectionById = new Map((inspections ?? []).map((i: any) => [i.id, i]))
  const zoneById       = new Map((zones ?? []).map((z: any) => [z.id, z]))
  const drawingById    = new Map((drawings ?? []).map((d: any) => [d.id, d]))

  const notes: SiteNote[] = [...rows.values()].map((row: any) => {
    const zone       = row.zone_id ? zoneById.get(row.zone_id) ?? null : null
    const drawing    = zone?.drawing_id ? drawingById.get(zone.drawing_id) ?? null : null
    const inspection = row.inspection_id ? inspectionById.get(row.inspection_id) ?? null : null

    return {
      id: row.id,
      status: noteStatus(row.severity),
      zoneLabel: row.zone_label || zone?.label || 'General Observation',
      description: (row.transcript || row.notes || '').trim(),
      photos: asArray<string>(row.photos).filter(u => typeof u === 'string' && u.startsWith('http')),
      measurements: asArray<NoteMeasurement>(row.measurements),
      observedAt: row.observed_at ?? row.created_at ?? null,
      inspectionId: row.inspection_id ?? null,
      reportNo: inspection?.report_no ?? null,
      visitDate: inspection?.date ?? null,
      zone: zone
        ? {
            id: zone.id,
            label: zone.label,
            x_percent: zone.x_percent,
            y_percent: zone.y_percent,
            markup_type: zone.markup_type ?? 'pin',
            shape_data: zone.shape_data ?? null,
            drawing_id: zone.drawing_id ?? null,
          }
        : null,
      drawing: drawing
        ? {
            id: drawing.id,
            title: drawing.title || 'Untitled drawing',
            number: drawing.number || '—',
            revision: drawing.revision || 'A',
            file_url: drawing.file_url,
          }
        : null,
    }
  })

  // Oldest first: site notes read as a running record of the job, so the
  // earliest observation belongs at the top.
  return notes.sort((a, b) => {
    const at = a.observedAt ? new Date(a.observedAt).getTime() : 0
    const bt = b.observedAt ? new Date(b.observedAt).getTime() : 0
    return at - bt
  })
}

/** Closing or reopening a note writes back to the same column the mobile app
 *  records it in, so the two stay in step. */
export async function setSiteNoteStatus(noteId: string, status: NoteStatus): Promise<void> {
  const { error } = await supabase.from('observations').update({ severity: status }).eq('id', noteId)
  if (error) throw new Error(error.message)
}

// ── RESPONSES ───────────────────────────────────────────────────────────────
// What came back after a note was raised: the contractor's reply, a photo of
// the remedial work, an email or a PDF. A note is usually closed once one
// lands, so the response panel offers "Save and close" alongside "Save".

export type NoteResponse = {
  id: string
  observationId: string
  comment: string
  fileUrl: string | null
  fileName: string | null
  fileType: string | null
  createdAt: string
}

/** The bucket the mobile app already uploads site photos to. Responses go in
 *  their own prefix so they can never be mistaken for site photos, which are
 *  what gets inserted into the report. */
const RESPONSE_BUCKET = 'observation-photos'
const RESPONSE_PREFIX = 'note-responses'

export const MAX_RESPONSE_FILE_BYTES = 25 * 1024 * 1024

/** Set up with web/sql/note_responses.sql. Shown in the UI if the table
 *  isn't there yet, so the one-off step explains itself rather than
 *  surfacing as a failed query. */
export const NOTE_RESPONSES_TABLE = 'note_responses'

function isMissingTable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false
  // PostgREST answers PGRST205 for an unknown table, and Postgres 42P01.
  return error.code === 'PGRST205' || error.code === '42P01' ||
    /could not find the table/i.test(error.message ?? '')
}

function toResponse(row: any): NoteResponse {
  return {
    id: row.id,
    observationId: row.observation_id,
    comment: row.comment ?? '',
    fileUrl: row.file_url ?? null,
    fileName: row.file_name ?? null,
    fileType: row.file_type ?? null,
    createdAt: row.created_at,
  }
}

/** Responses on one note, oldest first. `tableMissing` tells the caller to
 *  show the setup step instead of an error. */
export async function loadNoteResponses(
  observationId: string
): Promise<{ responses: NoteResponse[]; tableMissing: boolean }> {
  const { data, error } = await supabase
    .from(NOTE_RESPONSES_TABLE)
    .select('*')
    .eq('observation_id', observationId)
    .order('created_at', { ascending: true })

  if (error) {
    if (isMissingTable(error)) return { responses: [], tableMissing: true }
    throw new Error(error.message)
  }
  return { responses: (data ?? []).map(toResponse), tableMissing: false }
}

/** How many responses each of these notes has, for the list rows. Returns an
 *  empty map (not an error) when the table hasn't been created yet. */
export async function loadResponseCounts(observationIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (observationIds.length === 0) return counts

  const { data, error } = await supabase
    .from(NOTE_RESPONSES_TABLE)
    .select('observation_id')
    .in('observation_id', observationIds)

  if (error) {
    if (!isMissingTable(error)) console.error('[siteNotes] response counts failed:', error)
    return counts
  }
  for (const row of data ?? []) {
    counts.set(row.observation_id, (counts.get(row.observation_id) ?? 0) + 1)
  }
  return counts
}

/** Records a response against a note, uploading the file first if there is
 *  one. Either a comment or a file is enough — both is the common case. */
export async function addNoteResponse({
  observationId, comment, file,
}: {
  observationId: string
  comment: string
  file?: File | null
}): Promise<NoteResponse> {
  if (!comment.trim() && !file) {
    throw new Error('Add a note or attach a file before saving.')
  }
  if (file && file.size > MAX_RESPONSE_FILE_BYTES) {
    throw new Error(`That file is ${(file.size / 1e6).toFixed(1)} MB — the limit is ${MAX_RESPONSE_FILE_BYTES / 1e6} MB.`)
  }

  let fileUrl: string | null = null
  let fileName: string | null = null
  let fileType: string | null = null

  if (file) {
    // Prefixed with a timestamp so re-uploading a file of the same name
    // (very common — "IMG_0001.jpg", "scan.pdf") never overwrites an
    // earlier response.
    const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-80)
    const path = `${RESPONSE_PREFIX}/${observationId}/${Date.now()}-${safeName}`
    const { error: uploadError } = await supabase.storage
      .from(RESPONSE_BUCKET)
      .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
    if (uploadError) throw new Error('Could not upload the file: ' + uploadError.message)

    fileUrl  = supabase.storage.from(RESPONSE_BUCKET).getPublicUrl(path).data.publicUrl
    fileName = file.name
    fileType = file.type || null
  }

  const { data: { user } } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from(NOTE_RESPONSES_TABLE)
    .insert({
      observation_id: observationId,
      comment: comment.trim(),
      file_url: fileUrl,
      file_name: fileName,
      file_type: fileType,
      created_by: user?.id ?? null,
    })
    .select()
    .single()

  if (error) {
    if (isMissingTable(error)) {
      throw new Error(`The ${NOTE_RESPONSES_TABLE} table hasn't been created yet — run web/sql/note_responses.sql in the Supabase SQL editor.`)
    }
    throw new Error(error.message)
  }
  return toResponse(data)
}

export async function deleteNoteResponse(id: string): Promise<void> {
  const { error } = await supabase.from(NOTE_RESPONSES_TABLE).delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export function isImageResponse(response: NoteResponse): boolean {
  if (response.fileType?.startsWith('image/')) return true
  return /\.(png|jpe?g|gif|webp|heic)$/i.test(response.fileName ?? '')
}

/** "24 August 2026" as stored on the inspection, or a formatted timestamp. */
export function formatNoteDate(note: SiteNote): string {
  if (note.visitDate) return note.visitDate
  if (!note.observedAt) return '—'
  const d = new Date(note.observedAt)
  return isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })
}
