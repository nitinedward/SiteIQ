import { createClient } from '@supabase/supabase-js'

/**
 * Which photos a report holds, kept beside the report in storage.
 *
 * The photo section is rebuilt whenever the text is regenerated, and the
 * rebuild used to take every photo on the inspection — so photos the user
 * had left out came back with each "Generate AI report". The selection only
 * ever lived in the browser, so there was nothing better to go on. It is now
 * recorded whenever the photo section is written, and that record is what a
 * rebuild without a fresh selection uses, and what the report page shows as
 * selected when it opens.
 *
 * A file rather than a column so no migration is needed; the markups
 * already work the same way (their record is the files under
 * drawing-assets/<inspection>/).
 */

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
  (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()
)

/** A request's `selectedPhotoUrls`, or null when it didn't send one (the
 *  mobile app doesn't) — which means "use what is recorded". */
export function parseSelectedUrls(raw: unknown): string[] | null {
  return Array.isArray(raw) ? raw.filter((u): u is string => typeof u === 'string') : null
}

export const photoSelectionPath =(inspectionId: string) => `photo-selection/${inspectionId}.json`

/** The photo URLs the report was last written with, or null when nothing
 *  has been recorded (a report from before this existed, or one whose photo
 *  section has never been written). */
export async function readPhotoSelection(inspectionId: string): Promise<string[] | null> {
  const supabase = getSupabase()
  // Signed and cache-busted like loadDoc, so a CDN can't hand back the
  // selection from before the last write.
  const { data, error } = await supabase.storage
    .from('reports')
    .createSignedUrl(photoSelectionPath(inspectionId), 60)
  if (error || !data?.signedUrl) return null
  try {
    const res = await fetch(`${data.signedUrl}&t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    const parsed = await res.json()
    return Array.isArray(parsed?.photos)
      ? parsed.photos.filter((u: unknown): u is string => typeof u === 'string')
      : null
  } catch {
    return null
  }
}

/** Records the photos the report's photo section was just written with.
 *  Best-effort: the document is already stored, and a missing record only
 *  means the next rebuild without a selection falls back to every photo. */
export async function writePhotoSelection(inspectionId: string, urls: string[]): Promise<void> {
  try {
    const { error } = await getSupabase().storage
      .from('reports')
      .upload(
        photoSelectionPath(inspectionId),
        JSON.stringify({ photos: [...new Set(urls)] }),
        { contentType: 'application/json', upsert: true }
      )
    if (error) throw error
  } catch (err) {
    console.warn('[photoSelection] could not record the selection:', err)
  }
}
