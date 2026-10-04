import { createClient } from '@supabase/supabase-js'

/**
 * Which photos and markups a report holds, kept beside the report in
 * storage.
 *
 * The photo and markup sections are rebuilt whenever the text is
 * regenerated, and the rebuild used to take every photo on the inspection
 * and every markup ever captured for it — so ones the user had left out
 * came back with each "Generate AI report". The selection only ever lived
 * in the browser, so there was nothing better to go on. It is now recorded
 * whenever a section is written, and that record is what a rebuild without
 * a fresh selection uses, what the report page shows as ticked when it
 * opens, and how finalising knows which pictures the PDF holds.
 *
 *  - photos:   photo URLs, as on the observations
 *  - drawings: markup stems (lib/drawingAssetName), naming files under
 *              drawing-assets/<inspection>/
 *
 * A file rather than a column so no migration is needed. Either list is
 * null when it has never been recorded — a report from before this existed
 * — which callers treat as "everything", the old behaviour.
 */

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
  (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()
)

export type AttachmentSelection = {
  photos: string[] | null
  drawings: string[] | null
}

export const attachmentSelectionPath = (inspectionId: string) =>
  `attachment-selection/${inspectionId}.json`

const strings = (raw: unknown): string[] | null =>
  Array.isArray(raw) ? raw.filter((u): u is string => typeof u === 'string') : null

/** A request's list of selected URLs or stems, or null when it didn't send
 *  one (the mobile app doesn't) — which means "use what is recorded". */
export const parseSelected = strings

export async function readAttachmentSelection(inspectionId: string): Promise<AttachmentSelection> {
  const none: AttachmentSelection = { photos: null, drawings: null }
  const supabase = getSupabase()
  // Signed and cache-busted like loadDoc, so a CDN can't hand back the
  // selection from before the last write.
  const { data, error } = await supabase.storage
    .from('reports')
    .createSignedUrl(attachmentSelectionPath(inspectionId), 60)
  if (error || !data?.signedUrl) return none
  try {
    const res = await fetch(`${data.signedUrl}&t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return none
    const parsed = await res.json()
    return { photos: strings(parsed?.photos), drawings: strings(parsed?.drawings) }
  } catch {
    return none
  }
}

/** Records what a section was just written with. Only the lists passed are
 *  replaced — inserting photos alone leaves the markups' record as it was.
 *  Best-effort: the document is already stored, and a missing record only
 *  means the next rebuild without a selection falls back to everything. */
export async function writeAttachmentSelection(
  inspectionId: string,
  update: { photos?: string[]; drawings?: string[] },
): Promise<void> {
  try {
    const current = await readAttachmentSelection(inspectionId)
    const next = {
      photos: update.photos ? [...new Set(update.photos)] : current.photos,
      drawings: update.drawings ? [...new Set(update.drawings)] : current.drawings,
    }
    const { error } = await getSupabase().storage
      .from('reports')
      .upload(
        attachmentSelectionPath(inspectionId),
        JSON.stringify(next),
        { contentType: 'application/json', upsert: true }
      )
    if (error) throw error
  } catch (err) {
    console.warn('[attachmentSelection] could not record the selection:', err)
  }
}
