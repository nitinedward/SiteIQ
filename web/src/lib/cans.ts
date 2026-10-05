import { PDFDocument } from 'pdf-lib'
import { supabase } from '@/lib/supabase'
import { apiFetch } from '@/lib/apiFetch'
import { addSketch, type Sketch } from '@/lib/sketches'

/**
 * Consultant Advice Notices in the browser — see web/sql/cans.sql.
 *
 * A CAN is uploaded whole; AI proposes its details and which pages are
 * sketches (api/cans/analyse); the engineer confirms; then each confirmed
 * page becomes a sketch — its own single-page PDF, so it stays crisp — that
 * can be linked to a site note, and a hidden drawing companion so the
 * sketch can be opened and marked up on site with the drawing tools.
 */

export const CANS_TABLE = 'cans'
export const CANS_SQL_FILE = 'web/sql/cans.sql'

export type Can = {
  id: string
  projectId: string
  number: string
  title: string
  revision: string
  issuedOn: string | null
  summary: string
  fileUrl: string
  fileName: string | null
  pageCount: number
  status: 'current' | 'superseded'
  supersededBy: string | null
  createdAt: string
}

/** What the AI proposes (api/cans/analyse). */
export type CanReading = {
  can_number: string
  title: string
  revision: string
  issued_on: string
  summary: string
  page_count: number
  sketch_pages: { page: number; title: string; description: string }[]
}

function isMissingTable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false
  return error.code === 'PGRST205' || error.code === '42P01' ||
    /could not find the table/i.test(error.message ?? '')
}

function toCan(row: any): Can {
  return {
    id: row.id,
    projectId: row.project_id,
    number: row.number,
    title: row.title ?? '',
    revision: row.revision ?? '',
    issuedOn: row.issued_on ?? null,
    summary: row.summary ?? '',
    fileUrl: row.file_url,
    fileName: row.file_name ?? null,
    pageCount: row.page_count ?? 0,
    status: row.status === 'superseded' ? 'superseded' : 'current',
    supersededBy: row.superseded_by ?? null,
    createdAt: row.created_at,
  }
}

/** "CAN-003 Rev A" */
export function canLabel(c: { number: string; revision: string }): string {
  return `${c.number}${c.revision ? ` Rev ${c.revision}` : ''}`
}

/** A project's CANs, current first, then by number and newest revision. */
export async function loadProjectCans(projectId: string): Promise<{ cans: Can[]; tableMissing: boolean }> {
  const { data, error } = await supabase
    .from(CANS_TABLE)
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) {
    if (isMissingTable(error)) return { cans: [], tableMissing: true }
    throw new Error(error.message)
  }
  const cans = (data ?? []).map(toCan)
  return {
    cans: cans.sort((a, b) =>
      (a.status === b.status ? 0 : a.status === 'current' ? -1 : 1) ||
      a.number.localeCompare(b.number, undefined, { numeric: true }) ||
      b.createdAt.localeCompare(a.createdAt)
    ),
    tableMissing: false,
  }
}

/** Uploads the CAN's PDF straight to storage on a one-time link. Returns the
 *  id the CAN will be filed under and where its PDF now is. */
export async function uploadCanPdf(projectId: string, file: File): Promise<{ canId: string; fileUrl: string }> {
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
    throw new Error(`${file.name}: a CAN must be a PDF.`)
  }
  const res = await apiFetch('/api/cans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId }),
  })
  const link = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(link?.error ?? `upload failed (${res.status})`)
  const { error } = await supabase.storage
    .from('observation-photos')
    .uploadToSignedUrl(link.upload.path, link.upload.token, file, { contentType: 'application/pdf' })
  if (error) throw new Error('Upload failed: ' + error.message)
  return { canId: link.canId, fileUrl: link.upload.publicUrl }
}

/** Asks the AI to read the uploaded CAN. Throws with a message fit to show
 *  — the review screen then starts blank for the engineer to fill in. */
export async function analyseCan(projectId: string, canId: string): Promise<CanReading> {
  const res = await apiFetch('/api/cans/analyse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, canId }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.reading) throw new Error(data?.error ?? `reading failed (${res.status})`)
  return data.reading as CanReading
}

/** Small images of every page, for ticking sketch pages on the review
 *  screen. */
export async function pageThumbnails(file: File, longSide = 360): Promise<string[]> {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const out: string[] = []
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n)
    const natural = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: longSide / Math.max(natural.width, natural.height) })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise
    out.push(canvas.toDataURL('image/jpeg', 0.8))
  }
  return out
}

/** One page of a PDF as a PDF of its own — vector, so the sketch prints and
 *  marks up as crisply as the CAN itself. */
async function pageAsPdf(source: ArrayBuffer, page: number, name: string): Promise<File> {
  const src = await PDFDocument.load(source)
  const doc = await PDFDocument.create()
  const [copied] = await doc.copyPages(src, [page - 1])
  doc.addPage(copied)
  const bytes = await doc.save()
  return new File([bytes as unknown as BlobPart], name, { type: 'application/pdf' })
}

export type ConfirmedSketch = {
  page: number
  title: string
  observationId: string | null
  /** The note's report, so the sketch shows there; null for a note outside
   *  a site visit, or for none. */
  inspectionId: string | null
}

/**
 * Files a reviewed CAN: the record, then each confirmed sketch page as a
 * sketch with its on-site companion, then — if it is a new revision of a
 * CAN number already on the project — marks the earlier revision
 * superseded. Reports progress as it goes. A failure part-way leaves what
 * was filed; deleting the CAN clears it.
 */
export async function fileCan(
  {
    projectId, canId, fileUrl, file, pageCount,
    number, title, revision, issuedOn, summary, sketches,
  }: {
    projectId: string
    canId: string
    fileUrl: string
    file: File
    pageCount: number
    number: string
    title: string
    revision: string
    issuedOn: string
    summary: string
    sketches: ConfirmedSketch[]
  },
  onProgress: (message: string) => void = () => {},
): Promise<{ can: Can; sketches: Sketch[] }> {
  const cleanNumber = number.trim()
  if (!cleanNumber) throw new Error('Give the CAN its number.')
  const label = canLabel({ number: cleanNumber, revision: revision.trim() })

  const { data: existing } = await supabase
    .from(CANS_TABLE)
    .select('id, number, revision, status')
    .eq('project_id', projectId)
    .ilike('number', cleanNumber)
  if ((existing ?? []).some((c: any) => (c.revision ?? '').toLowerCase() === revision.trim().toLowerCase())) {
    throw new Error(`${label} is already on this project. If this is a new revision, give it the new revision letter.`)
  }
  const previous = (existing ?? []).filter((c: any) => c.status === 'current')

  onProgress(`Filing ${label}`)
  const { data: { user } } = await supabase.auth.getUser()
  const { data: row, error } = await supabase
    .from(CANS_TABLE)
    .insert({
      id: canId,
      project_id: projectId,
      number: cleanNumber,
      title: title.trim(),
      revision: revision.trim(),
      issued_on: issuedOn || null,
      summary: summary.trim(),
      file_url: fileUrl,
      file_name: file.name,
      page_count: pageCount,
      created_by: user?.id ?? null,
    })
    .select()
    .single()
  if (error) {
    if (isMissingTable(error)) throw new Error(`CANs aren't set up yet — run ${CANS_SQL_FILE} in the Supabase SQL editor.`)
    throw new Error(error.message)
  }
  const can = toCan(row)

  const source = await file.arrayBuffer()
  const filed: Sketch[] = []
  for (const [i, s] of sketches.entries()) {
    onProgress(`Adding sketch ${i + 1} of ${sketches.length} (page ${s.page})`)
    const pageFile = await pageAsPdf(source, s.page, `${cleanNumber} p${s.page}.pdf`.replace(/[\\/:*?"<>|]/g, '-'))
    const sketch = await addSketch(pageFile, {
      projectId,
      inspectionId: s.inspectionId,
      observationId: s.observationId,
      title: s.title.trim() || `${label} page ${s.page}`,
      canId: can.id,
      canPage: s.page,
    })
    // The companion that puts the sketch in the drawing lists on site —
    // the phone app opens and marks up anything in drawings. Hidden from
    // the web's Drawings tab by its kind.
    const { error: drawErr } = await supabase.from('drawings').insert({
      project_id: projectId,
      title: `${sketch.title} (${label})`,
      number: `${cleanNumber} p${s.page}`,
      revision: revision.trim(),
      file_url: sketch.fileUrl,
      file_name: pageFile.name,
      preview_url: sketch.pages[0]?.url ?? null,
      kind: 'sketch',
      sketch_id: sketch.id,
    })
    if (drawErr) throw new Error(`Sketch on page ${s.page} was saved, but couldn't be made available on site: ${drawErr.message}`)
    filed.push(sketch)
  }

  if (previous.length > 0) {
    onProgress('Superseding the earlier revision')
    await supabase
      .from(CANS_TABLE)
      .update({ status: 'superseded', superseded_by: can.id })
      .in('id', previous.map((c: any) => c.id))
  }

  return { can, sketches: filed }
}

/** Deletes a CAN with its sketches and files (through /api/cans). Refused
 *  while site markups depend on its sketches. */
export async function deleteCan(canId: string): Promise<void> {
  const res = await apiFetch('/api/cans', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ canId }),
  })
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    throw new Error(payload?.error ?? `Could not delete the CAN (${res.status})`)
  }
}

/** Discards an uploaded CAN that was never filed (the review was
 *  cancelled), so its PDF doesn't sit in storage. Best-effort. */
export async function discardCanUpload(projectId: string, canId: string): Promise<void> {
  try {
    await apiFetch('/api/cans', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canId, projectId, unfiled: true }),
    })
  } catch {
    // leaves one PDF behind; harmless
  }
}
