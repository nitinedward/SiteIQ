import { supabase } from '@/lib/supabase'

/**
 * Sketches in the browser — see web/sql/sketches.sql.
 *
 * An engineer sketches by hand or in Bluebeam, then drops the scan, photo or
 * PDF in here, linked to the site note it explains. The report page and the
 * Site Notes tab both list them, so a sketch can be traced from its note and
 * a note from its sketch.
 */

export const SKETCHES_TABLE = 'sketches'
export const SKETCHES_SQL_FILE = 'web/sql/sketches.sql'

export type SketchPage = { url: string; width: number; height: number }

export type Sketch = {
  id: string
  projectId: string
  inspectionId: string | null
  observationId: string | null
  title: string
  fileUrl: string
  fileName: string | null
  fileType: string | null
  pages: SketchPage[]
  createdAt: string
}

/** What a sketch can be made from. */
export const SKETCH_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp'

/** Long side of a PDF page rendered for the report, in pixels. Matches what
 *  the report builder shrinks sketches to, so nothing is rendered only to be
 *  thrown away. */
const PAGE_RENDER_PX = 2400

function isMissingTable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false
  return error.code === 'PGRST205' || error.code === '42P01' ||
    /could not find the table/i.test(error.message ?? '')
}

function toSketch(row: any): Sketch {
  return {
    id: row.id,
    projectId: row.project_id,
    inspectionId: row.inspection_id ?? null,
    observationId: row.observation_id ?? null,
    title: row.title ?? '',
    fileUrl: row.file_url,
    fileName: row.file_name ?? null,
    fileType: row.file_type ?? null,
    pages: Array.isArray(row.pages) ? row.pages.filter((p: any) => p?.url) : [],
    createdAt: row.created_at,
  }
}

/** The report's sketches: those on its site notes, plus its General ones.
 *  `tableMissing` tells the caller to show the setup step instead. */
export async function loadReportSketchRows(
  inspectionId: string,
  noteIds: string[],
): Promise<{ sketches: Sketch[]; tableMissing: boolean }> {
  let query = supabase.from(SKETCHES_TABLE).select('*')
  query = noteIds.length > 0
    ? query.or(`inspection_id.eq.${inspectionId},observation_id.in.(${noteIds.join(',')})`)
    : query.eq('inspection_id', inspectionId)
  const { data, error } = await query.order('created_at', { ascending: true })
  if (error) {
    if (isMissingTable(error)) return { sketches: [], tableMissing: true }
    throw new Error(error.message)
  }
  const ours = new Set(noteIds)
  return {
    // Linked to a note in another report: that report's, not this one's.
    sketches: (data ?? []).map(toSketch).filter(s => !s.observationId || ours.has(s.observationId)),
    tableMissing: false,
  }
}

/** Sketches on these site notes, grouped by note. */
export async function loadNoteSketches(
  observationIds: string[],
): Promise<{ byNote: Map<string, Sketch[]>; tableMissing: boolean }> {
  const byNote = new Map<string, Sketch[]>()
  if (observationIds.length === 0) return { byNote, tableMissing: false }
  const { data, error } = await supabase
    .from(SKETCHES_TABLE)
    .select('*')
    .in('observation_id', observationIds)
    .order('created_at', { ascending: true })
  if (error) {
    if (isMissingTable(error)) return { byNote, tableMissing: true }
    throw new Error(error.message)
  }
  for (const s of (data ?? []).map(toSketch)) {
    const list = byNote.get(s.observationId!) ?? []
    list.push(s)
    byNote.set(s.observationId!, list)
  }
  return { byNote, tableMissing: false }
}

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('You are signed out — sign in again to add a sketch.')
  return { Authorization: `Bearer ${session.access_token}` }
}

/** Each page of a PDF as a PNG, at the size the report uses. */
async function renderPdfPages(file: File): Promise<{ blob: Blob; width: number; height: number }[]> {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise

  const pages: { blob: Blob; width: number; height: number }[] = []
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n)
    const natural = page.getViewport({ scale: 1 })
    const scale = Math.min(4, PAGE_RENDER_PX / Math.max(natural.width, natural.height))
    const viewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext('2d')!
    // White, not transparent: a PDF page with no background would otherwise
    // come out black where it is empty.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise

    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not render page ' + n))), 'image/png')
    )
    pages.push({ blob, width: canvas.width, height: canvas.height })
  }
  return pages
}

async function imageSize(file: File): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(file)
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return size
  } catch {
    return { width: 0, height: 0 }
  }
}

const extOf = (name: string) => (name.split('.').pop() ?? '').toLowerCase()

/** Uploads a sketch file and records it against its site note (or as
 *  General for the report). A PDF goes in page by page; an image is its own
 *  single page. Returns the new sketch. */
export async function addSketch(
  file: File,
  { projectId, inspectionId, observationId, title }: {
    projectId: string
    inspectionId: string | null
    observationId: string | null
    title: string
  },
): Promise<Sketch> {
  const ext = extOf(file.name)
  const isPdf = ext === 'pdf' || file.type === 'application/pdf'
  if (!isPdf && !['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
    throw new Error(`${file.name}: a sketch must be a PDF, PNG or JPG.`)
  }

  const rendered = isPdf ? await renderPdfPages(file) : []
  if (isPdf && rendered.length === 0) throw new Error(`${file.name} has no pages.`)

  const res = await fetch('/api/sketches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ projectId, originalExt: isPdf ? 'pdf' : ext, pageCount: rendered.length }),
  })
  const links = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${file.name}: ${links?.error ?? `upload failed (${res.status})`}`)

  const bucket = supabase.storage.from('observation-photos')
  const put = async (upload: { path: string; token: string }, body: Blob, contentType: string) => {
    const { error } = await bucket.uploadToSignedUrl(upload.path, upload.token, body, { contentType })
    if (error) throw new Error(`${file.name}: upload failed — ${error.message}`)
  }

  await put(links.original, file, file.type || (isPdf ? 'application/pdf' : `image/${ext === 'jpg' ? 'jpeg' : ext}`))
  await Promise.all(rendered.map((p, i) => put(links.pages[i], p.blob, 'image/png')))

  const pages: SketchPage[] = isPdf
    ? rendered.map((p, i) => ({ url: links.pages[i].publicUrl, width: p.width, height: p.height }))
    : [{ url: links.original.publicUrl, ...(await imageSize(file)) }]

  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from(SKETCHES_TABLE)
    .insert({
      id: links.sketchId,
      project_id: projectId,
      inspection_id: inspectionId,
      observation_id: observationId,
      title: title.trim(),
      file_url: links.original.publicUrl,
      file_name: file.name,
      file_type: file.type || null,
      pages,
      created_by: user?.id ?? null,
    })
    .select()
    .single()
  if (error) {
    if (isMissingTable(error)) {
      throw new Error(`Sketches aren't set up yet — run ${SKETCHES_SQL_FILE} in the Supabase SQL editor.`)
    }
    throw new Error(error.message)
  }
  return toSketch(data)
}

/** Links a sketch to a different site note, or to none (General). */
export async function moveSketch(sketchId: string, observationId: string | null, inspectionId: string | null): Promise<void> {
  const { error } = await supabase
    .from(SKETCHES_TABLE)
    .update({ observation_id: observationId, inspection_id: inspectionId })
    .eq('id', sketchId)
  if (error) throw new Error(error.message)
}

export async function renameSketch(sketchId: string, title: string): Promise<void> {
  const { error } = await supabase.from(SKETCHES_TABLE).update({ title: title.trim() }).eq('id', sketchId)
  if (error) throw new Error(error.message)
}

/** Deletes a sketch and its files (through /api/sketches, which holds the
 *  key the files need). */
export async function deleteSketch(sketchId: string): Promise<void> {
  const res = await fetch('/api/sketches', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ sketchId }),
  })
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    throw new Error(payload?.error ?? `Could not delete the sketch (${res.status})`)
  }
}

/** "Sketch.pdf · 3 pages" — the line under a sketch's title in a list. */
export function sketchSummary(sketch: Sketch): string {
  const n = sketch.pages.length
  return `${sketch.fileName ?? 'Sketch'}${n > 1 ? ` · ${n} pages` : ''}`
}
