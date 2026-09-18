import { createClient } from '@supabase/supabase-js'
import { saveDoc } from './docStorage'
import { carryAttachmentsForward } from './attachmentSections'
import { appendAttachments } from './appendAttachments'

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
 * browser and stashed under drawing-assets/<inspection>/<number>.png by
 * /api/docs/drawing-asset, so the stored files are the record of which
 * markups were inserted; the drawing row supplies the caption.
 */
async function loadDrawings(inspectionId: string, projectId: string): Promise<RebuiltDrawing[]> {
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
    const { data: signed } = await supabase.storage
      .from('reports')
      .createSignedUrl(`${folder}/${file.name}`, 3600)
    if (!signed?.signedUrl) continue

    // The file is named after the drawing number, with anything awkward
    // replaced by a dash when it was uploaded.
    const stem = file.name.replace(/\.png$/i, '')
    const match = (drawings ?? []).find(
      (d: any) => (d.number ?? '').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) === stem
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
 * Stores a regenerated document, then rebuilds its photo and markup
 * sections. Returns what was rebuilt, for the
 * caller to report back to the UI. Never throws: a report whose sections
 * can't be rebuilt keeps the document that was just written.
 */
export async function writeWithRebuiltAttachments(
  inspectionId: string,
  projectId: string,
  buffer: Buffer,
): Promise<string[]> {
  let photos: RebuiltPhoto[] = []
  let drawings: RebuiltDrawing[] = []
  try {
    ;[photos, drawings] = await Promise.all([loadPhotos(inspectionId), loadDrawings(inspectionId, projectId)])
  } catch (err) {
    console.warn('[attachments] could not read what to rebuild:', err)
  }

  if (photos.length === 0 && drawings.length === 0) {
    // Nothing recorded — fall back to lifting whatever the old document holds.
    const carried = await carryAttachmentsForward(inspectionId, buffer)
    await saveDoc(inspectionId, carried.buffer)
    return carried.carried
  }

  await saveDoc(inspectionId, buffer)

  try {
    // In-process rather than a call back into /api/docs/append: a function
    // calling its own deployment over HTTP answers to whatever protection
    // sits in front of it, and a failure there costs the report its photos.
    const result = await appendAttachments({ inspectionId, photos, drawings })
    console.log('[attachments] rebuilt —', result.photosAdded, 'photos,', result.drawingsAdded, 'markups')
  } catch (err) {
    console.error('[attachments] rebuild failed, document written without them:', err)
    return []
  }

  const rebuilt: string[] = []
  if (drawings.length > 0) rebuilt.push('siteiq_drawings')
  if (photos.length > 0) rebuilt.push('siteiq_photos')
  return rebuilt
}
