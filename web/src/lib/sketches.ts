import { PDFDocument } from 'pdf-lib'
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
  /** The CAN it was taken from, and the page — web/sql/cans.sql. */
  canId: string | null
  canPage: number | null
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
    canId: row.can_id ?? null,
    canPage: row.can_page ?? null,
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

/** Every sketch on a project — from CANs, site notes and reports — newest
 *  first, for the project's Sketches tab. */
export async function loadProjectSketches(
  projectId: string,
): Promise<{ sketches: Sketch[]; tableMissing: boolean }> {
  const { data, error } = await supabase
    .from(SKETCHES_TABLE)
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) {
    if (isMissingTable(error)) return { sketches: [], tableMissing: true }
    throw new Error(error.message)
  }
  return { sketches: (data ?? []).map(toSketch), tableMissing: false }
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

/** An uploaded image as a PNG, whatever it came as (JPG, WebP…). */
async function imageAsPng(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not read ' + file.name))), 'image/png'))
  return { blob, width: canvas.width, height: canvas.height }
}

/** A page image as a one-page PDF — what the phone app's drawing viewer
 *  opens and marks up. Sized as an A3 sheet on its long side. */
async function pageImageAsPdf(png: Blob, width: number, height: number): Promise<Blob> {
  const doc = await PDFDocument.create()
  const image = await doc.embedPng(await png.arrayBuffer())
  const scale = 1190 / Math.max(width || 1, height || 1)
  const w = (width || 1190) * scale
  const h = (height || 842) * scale
  doc.addPage([w, h]).drawImage(image, { x: 0, y: 0, width: w, height: h })
  return new Blob([await doc.save() as unknown as BlobPart], { type: 'application/pdf' })
}

/** Uploads a sketch file and records it against its site note (or as
 *  General for the report). A PDF goes in page by page; an image is its own
 *  single page. Returns the new sketch. */
export async function addSketch(
  file: File,
  { projectId, inspectionId, observationId, title, canId = null, canPage = null, onSite = false }: {
    projectId: string
    inspectionId: string | null
    observationId: string | null
    title: string
    /** Set when the sketch is a page of a CAN (lib/cans). */
    canId?: string | null
    canPage?: number | null
    /** Also make it available on site: each page as a one-page PDF with a
     *  hidden drawing companion, so the phone app opens and marks it up like
     *  a drawing (web/sql/cans.sql). A CAN's sketches do this themselves. */
    onSite?: boolean
  },
): Promise<Sketch> {
  const ext = extOf(file.name)
  const isPdf = ext === 'pdf' || file.type === 'application/pdf'
  if (!isPdf && !['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
    throw new Error(`${file.name}: a sketch must be a PDF, PNG or JPG.`)
  }

  const rendered = isPdf ? await renderPdfPages(file) : []
  if (isPdf && rendered.length === 0) throw new Error(`${file.name} has no pages.`)

  // The pages the site copies are made from: the rendered PDF pages, or the
  // image itself.
  const sitePages = onSite ? (isPdf ? rendered : [await imageAsPng(file)]) : []

  const res = await fetch('/api/sketches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ projectId, originalExt: isPdf ? 'pdf' : ext, pageCount: rendered.length, sitePdfCount: sitePages.length }),
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
  await Promise.all(sitePages.map(async (p, i) =>
    put(links.sitePdfs[i], await pageImageAsPdf(p.blob, p.width, p.height), 'application/pdf')))

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
      // Only sent for a CAN's sketch, so adding one keeps working on a
      // database where cans.sql hasn't been run.
      ...(canId ? { can_id: canId, can_page: canPage } : {}),
    })
    .select()
    .single()
  if (error) {
    if (isMissingTable(error)) {
      throw new Error(`Sketches aren't set up yet — run ${SKETCHES_SQL_FILE} in the Supabase SQL editor.`)
    }
    throw new Error(error.message)
  }
  const sketch = toSketch(data)

  if (sitePages.length > 0) {
    const name = sketch.title || file.name.replace(/\.[^.]+$/, '')
    const { error: siteErr } = await supabase.from('drawings').insert(sitePages.map((_, i) => ({
      project_id: projectId,
      title: `${name}${sitePages.length > 1 ? ` (page ${i + 1} of ${sitePages.length})` : ''} — sketch`,
      number: `SKETCH${sitePages.length > 1 ? ` p${i + 1}` : ''}`,
      revision: '',
      file_url: links.sitePdfs[i].publicUrl,
      file_name: `site-${i + 1}.pdf`,
      preview_url: sketch.pages[i]?.url ?? null,
      kind: 'sketch',
      sketch_id: sketch.id,
    })))
    // The sketch itself is saved either way; only the site copy is missing
    // (most likely cans.sql, which adds drawings.kind, hasn't been run).
    if (siteErr) console.warn('[sketches] saved, but not made available on site:', siteErr.message)
  }
  return sketch
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
