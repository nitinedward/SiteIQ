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
  /** What was dictated or typed on site. Never rewritten by the report. */
  description: string
  /** How the generated report words this same observation, or null if no
   *  report has been generated for it yet. */
  reportText: string | null
  photos: string[]
  measurements: NoteMeasurement[]
  observedAt: string | null
  inspectionId: string | null
  reportNo: string | null
  visitDate: string | null
  zone: NoteZone | null
  drawing: NoteDrawing | null
}

/** Observations are stored open/closed in the `severity` column — the name
 *  is historic, the graded values it used to hold were migrated to OPEN and
 *  the database no longer accepts them (web/sql/observation_status.sql).
 *  Only an explicit 'CLOSED' is closed; anything else is open.
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
      // Undefined until a report has been generated for this observation, and
      // until web/sql/observation_report_text.sql has been run.
      reportText: (row.report_text ?? '').trim() || null,
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
  if (!error) return

  // The column still carries the old severity-grade check constraint on
  // databases where web/sql/observation_status.sql hasn't been run. Say what
  // to do about it rather than passing the raw Postgres message on.
  if (/observations_severity_check/.test(error.message)) {
    throw new Error(
      'The database still restricts this field to the old severity grades, so open/closed can’t be saved yet. ' +
      'Run web/sql/observation_status.sql once in the Supabase SQL editor.'
    )
  }
  throw new Error(error.message)
}

// ── RESPONSES ───────────────────────────────────────────────────────────────
// What came back after a note was raised: the contractor's reply, a photo of
// the remedial work, an email or a PDF. A note is usually closed once one
// lands, so the response panel offers "Save and close" alongside "Save".

export type NoteFile = { url: string; name: string; type: string | null }

export type NoteResponse = {
  id: string
  observationId: string
  comment: string
  /** The files attached to THIS comment. Stored in the `files` column; a
   *  response written before that column existed carries a single file in
   *  file_url/file_name/file_type and is read back the same way. */
  files: NoteFile[]
  createdAt: string
}

// Files are stored by /api/notes/response-file, in the public
// observation-photos bucket under note-responses/<observation id>/ — their
// own prefix, so they can never be mistaken for the site photos that get
// inserted into the report.

export const MAX_RESPONSE_FILE_BYTES = 25 * 1024 * 1024

/** Set up with web/sql/note_responses.sql. Shown in the UI if the table
 *  isn't there yet, so the one-off step explains itself rather than
 *  surfacing as a failed query. */
export const NOTE_RESPONSES_TABLE = 'note_responses'

/** PostgREST answers PGRST204 when a column in the payload doesn't exist. */
function isMissingFilesColumn(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false
  return error.code === 'PGRST204' && /'files'/.test(error.message ?? '')
}

function isMissingTable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false
  // PostgREST answers PGRST205 for an unknown table, and Postgres 42P01.
  return error.code === 'PGRST205' || error.code === '42P01' ||
    /could not find the table/i.test(error.message ?? '')
}

function toResponse(row: any): NoteResponse {
  const stored: NoteFile[] = Array.isArray(row.files)
    ? row.files.filter((f: any) => f?.url)
    : []

  return {
    id: row.id,
    observationId: row.observation_id,
    comment: row.comment ?? '',
    files: stored.length > 0
      ? stored
      : row.file_url
        ? [{ url: row.file_url, name: row.file_name ?? 'Attachment', type: row.file_type ?? null }]
        : [],
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
/** Uploads one file through our own route, which stores it with the service
 *  role — a browser-side storage write depends on the bucket's policies
 *  allowing this user to write to this prefix, and fails in a way that is
 *  hard to surface. See src/app/api/notes/response-file/route.ts. */
async function uploadResponseFile(observationId: string, file: File): Promise<NoteFile> {
  if (file.size > MAX_RESPONSE_FILE_BYTES) {
    throw new Error(`${file.name} is ${(file.size / 1e6).toFixed(1)} MB — the limit is ${MAX_RESPONSE_FILE_BYTES / 1e6} MB.`)
  }
  const res = await fetch(
    `/api/notes/response-file?observationId=${encodeURIComponent(observationId)}&name=${encodeURIComponent(file.name)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    }
  )
  const payload = await res.json().catch(() => ({}))
  if (!res.ok || !payload?.url) {
    throw new Error('Could not upload ' + file.name + ': ' + (payload?.error ?? `upload failed (${res.status})`))
  }
  return { url: payload.url, name: file.name, type: file.type || null }
}

/** Records one comment together with the files that belong to it — they are
 *  a single entry in the note's history, not a comment and some loose
 *  uploads. */
export async function addNoteResponse({
  observationId, comment, files = [],
}: {
  observationId: string
  comment: string
  files?: File[]
}): Promise<NoteResponse> {
  if (!comment.trim() && files.length === 0) {
    throw new Error('Add a comment or attach a file before saving.')
  }

  const uploaded: NoteFile[] = []
  for (const file of files) {
    uploaded.push(await uploadResponseFile(observationId, file))
  }

  const { data: { user } } = await supabase.auth.getUser()

  const row: Record<string, any> = {
    observation_id: observationId,
    comment: comment.trim(),
    files: uploaded,
    // Also written to the original single-file columns so a response stays
    // readable by anything looking at those, and by this app if the `files`
    // column is ever rolled back.
    file_url:  uploaded[0]?.url  ?? null,
    file_name: uploaded[0]?.name ?? null,
    file_type: uploaded[0]?.type ?? null,
    created_by: user?.id ?? null,
  }

  let { data, error } = await supabase.from(NOTE_RESPONSES_TABLE).insert(row).select().single()

  // The `files` column arrived after the table did. Without it, fall back to
  // the original shape — one row per file — so responses still save on a
  // database where web/sql/note_response_files.sql hasn't been run.
  if (error && isMissingFilesColumn(error)) {
    const { files: _dropped, ...legacyRow } = row
    const first = await supabase.from(NOTE_RESPONSES_TABLE).insert(legacyRow).select().single()
    if (first.error) throw new Error(first.error.message)
    for (const extra of uploaded.slice(1)) {
      await supabase.from(NOTE_RESPONSES_TABLE).insert({
        observation_id: observationId,
        comment: '',
        file_url: extra.url, file_name: extra.name, file_type: extra.type,
        created_by: user?.id ?? null,
      })
    }
    return toResponse(first.data)
  }

  if (error) {
    if (isMissingTable(error)) {
      throw new Error(`The ${NOTE_RESPONSES_TABLE} table hasn't been created yet — run web/sql/note_responses.sql in the Supabase SQL editor.`)
    }
    throw new Error(error.message)
  }
  return toResponse(data)
}

export async function deleteNoteResponse(id: string): Promise<void> {
  // `select()` so the removal can be confirmed. Row-level security filters a
  // delete rather than refusing it, so a comment someone else added comes
  // back as a success that deleted nothing — and the UI would drop it from
  // the list while it sat in the database, reappearing on the next open.
  const { data, error } = await supabase
    .from(NOTE_RESPONSES_TABLE)
    .delete()
    .eq('id', id)
    .select('id')

  if (error) throw new Error(error.message)
  if (!data || data.length === 0) {
    throw new Error('That comment could not be removed — it was added by someone else.')
  }
}

export function isImageFile(file: NoteFile): boolean {
  if (file.type?.startsWith('image/')) return true
  return /\.(png|jpe?g|gif|webp|heic)$/i.test(file.name ?? '')
}

/** Whether a browser can display the file itself. A PDF or an image opens
 *  in a tab; a Word or Excel file can only be downloaded, so the panel says
 *  "Download" rather than offering a view that would never appear. */
export function isViewableFile(file: NoteFile): boolean {
  if (isImageFile(file)) return true
  if (file.type === 'application/pdf') return true
  return /\.(pdf|txt|csv)$/i.test(file.name ?? '')
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
