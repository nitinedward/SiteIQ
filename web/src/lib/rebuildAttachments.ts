import { createClient } from '@supabase/supabase-js'
import { saveDoc } from './docStorage'
import { carryAttachmentsForward } from './attachmentSections'
import { appendAttachments } from './appendAttachments'
import { NotSettledError } from './quiesceDocument'
import { readAttachmentSelection } from './attachmentSelection'
import { loadReportSketches } from './reportSketches'
import { drawingAssetStem } from './drawingAssetName'

/**
 * Rebuilding a regenerated report's photo and markup sections from the
 * database, rather than lifting them out of the previous document.
 *
 * Carrying them across worked until a report had been through the editor:
 * OnlyOffice moves the section bookmarks inside paragraphs, and only whole
 * paragraphs can be lifted safely, so the half-paragraph at the edge — a
 * drawing's "Ref: … Rev …" caption — was dropped. The photos and markups
 * are all recorded, so they are rebuilt from the record instead and the
 * captions always read what the drawing says.
 *
 * Carrying stays as the fallback for a report with nothing recorded.
 */

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
  (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()
)

export type RebuiltPhoto = { url: string; zoneLabel: string }
export type RebuiltDrawing = { title: string; number: string; revision: string; url: string }

function asArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((u): u is string => typeof u === 'string')
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw || '[]')
      return Array.isArray(parsed) ? parsed.filter((u: unknown): u is string => typeof u === 'string') : []
    } catch { return [] }
  }
  return []
}

/** Every photo on the inspection, in note order, labelled by its note. */
async function loadPhotos(inspectionId: string): Promise<RebuiltPhoto[]> {
  const { data: notes } = await getSupabase()
    .from('observations')
    .select('id, zone_label, photos')
    .eq('inspection_id', inspectionId)
    .order('id', { ascending: true })

  return (notes ?? []).flatMap((note: any) =>
    asArray(note.photos)
      .filter(url => url.startsWith('http'))
      .map(url => ({ url, zoneLabel: note.zone_label || 'General Observation' }))
  )
}

/**
 * The marked-up drawings captured for this report. They're rendered in the
 * browser and stashed under drawing-assets/<inspection>/<stem>.png by
 * /api/docs/drawing-asset; the drawing row supplies the caption.
 *
 * A stored image only means the markup was captured at some point, not that
 * the report holds it — unticking a markup leaves its file behind. So
 * `chosen` (stems) limits which are used; null means every stored one, for
 * a report with no recorded selection.
 */
async function loadDrawings(
  inspectionId: string,
  projectId: string,
  chosen: Set<string> | null,
): Promise<RebuiltDrawing[]> {
  const supabase = getSupabase()
  const folder = `drawing-assets/${inspectionId}`
  const { data: files, error } = await supabase.storage.from('reports').list(folder, { limit: 100 })
  if (error || !files || files.length === 0) return []

  const { data: drawings } = await supabase
    .from('drawings')
    .select('title, number, revision')
    .eq('project_id', projectId)

  const out: RebuiltDrawing[] = []
  for (const file of files.filter(f => f.name.endsWith('.png'))) {
    const stem = file.name.replace(/\.png$/i, '')
    if (chosen && !chosen.has(stem)) continue

    const { data: signed } = await supabase.storage
      .from('reports')
      .createSignedUrl(`${folder}/${file.name}`, 3600)
    if (!signed?.signedUrl) continue

    const match = (drawings ?? []).find(
      (d: any) => drawingAssetStem(d.number ?? '') === stem
    )
    out.push({
      title: match?.title || stem,
      number: match?.number || stem,
      revision: match?.revision || 'A',
      url: signed.signedUrl,
    })
  }
  // Ordered by drawing number so the section reads the same every rebuild.
  return out.sort((a, b) => a.number.localeCompare(b.number))
}

/**
 * Rebuilds a regenerated document's photo and markup sections, then stores
 * it. Returns what was rebuilt, for the
 * caller to report back to the UI. A report whose sections can't be rebuilt
 * is still stored, without them.
 *
 * `gate` (see quiesceGate) is awaited before the stored file is read or
 * written; the photos are fetched and shrunk while it is pending. The only
 * thing this throws is the gate's NotSettledError, and then nothing has been
 * stored — not even the fallback without photos, since storing anything is
 * what would be overwritten.
 *
 * Which photos and markups go back in: the user's current ticks when the
 * caller sends them (`photos` as URLs, `drawings` as stems), otherwise the
 * selection recorded when each section was last written
 * (lib/attachmentSelection). Only a report with neither — one from before
 * selections were recorded — gets every photo on the inspection and every
 * stored markup, as all rebuilds used to. Selected entries that aren't this
 * inspection's photos or stored markups are ignored, so a request can't
 * make the server fetch anything else.
 *
 * Sketches (`sketches`, ids) work the same way, except that without a fresh
 * selection the report also takes any sketch attached to one of its site
 * notes since — see lib/sketchSelection.
 */
export async function writeWithRebuiltAttachments(
  inspectionId: string,
  projectId: string,
  buffer: Buffer,
  {
    gate = Promise.resolve(),
    photos: selectedPhotos = null,
    drawings: selectedDrawings = null,
    sketches: selectedSketches = null,
  }: {
    gate?: Promise<void>
    photos?: string[] | null
    drawings?: string[] | null
    sketches?: string[] | null
  } = {},
): Promise<string[]> {
  let photoSel = selectedPhotos
  let drawingSel = selectedDrawings
  if (!photoSel || !drawingSel) {
    try {
      const recorded = await readAttachmentSelection(inspectionId)
      photoSel ??= recorded.photos
      drawingSel ??= recorded.drawings
    } catch (err) {
      console.warn('[attachments] could not read the recorded selection:', err)
    }
  }
  const chosenPhotos = photoSel ? new Set(photoSel) : null
  const chosenDrawings = drawingSel ? new Set(drawingSel) : null

  let allPhotos: RebuiltPhoto[] = []
  let drawings: RebuiltDrawing[] = []
  try {
    ;[allPhotos, drawings] = await Promise.all([
      loadPhotos(inspectionId),
      loadDrawings(inspectionId, projectId, chosenDrawings),
    ])
  } catch (err) {
    console.warn('[attachments] could not read what to rebuild:', err)
  }
  const photos = chosenPhotos ? allPhotos.filter(p => chosenPhotos.has(p.url)) : allPhotos

  // Nothing recorded at all and nothing to put in — a report from before any
  // of this was recorded: lift whatever the old document holds instead,
  // which reads the stored file, so only once settled. With anything chosen
  // (even an empty choice) the sections are rebuilt below, never carried —
  // carrying would put back exactly what was left out.
  if (
    photos.length === 0 && drawings.length === 0 && !chosenPhotos && !chosenDrawings &&
    !selectedSketches?.length && (await loadReportSketches(inspectionId)).length === 0
  ) {
    await gate
    const carried = await carryAttachmentsForward(inspectionId, buffer)
    await saveDoc(inspectionId, carried.buffer)
    return carried.carried
  }

  let result: Awaited<ReturnType<typeof appendAttachments>>
  try {
    // In-process rather than a call back into /api/docs/append: a function
    // calling its own deployment over HTTP answers to whatever protection
    // sits in front of it, and a failure there costs the report its photos.
    // Handed the buffer so the document is stored once, with its sections,
    // rather than stored bare, read straight back and stored again. Empty
    // lists write no section, and are recorded as chosen.
    result = await appendAttachments({
      inspectionId, photos, drawings, docBuffer: buffer, gate,
      sketches: selectedSketches ?? undefined,
    })
    console.log('[attachments] rebuilt —', result.photosAdded, 'photos,', result.drawingsAdded, 'markups,', result.sketchesAdded, 'sketches')
  } catch (err) {
    if (err instanceof NotSettledError) throw err
    console.error('[attachments] rebuild failed, writing the document without them:', err)
    // A rebuild can fail before reaching the gate (e.g. a bad markup), so
    // the fallback waits on it too.
    await gate
    await saveDoc(inspectionId, buffer)
    return []
  }

  const rebuilt: string[] = []
  if (drawings.length > 0) rebuilt.push('siteiq_drawings')
  if (result.sketchesAdded > 0) rebuilt.push('siteiq_sketches')
  if (photos.length > 0) rebuilt.push('siteiq_photos')
  return rebuilt
}
