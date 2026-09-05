import { createClient } from '@supabase/supabase-js'

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
  (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()
)

export async function saveDoc(
  inspectionId: string,
  buffer: Buffer
): Promise<void> {
  const supabase = getSupabase()
  const { error } = await supabase.storage
    .from('reports')
    .upload(
      `${inspectionId}.docx`,
      buffer,
      {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: true,
      }
    )
  if (error) throw new Error('Failed to save doc: ' + error.message)
  console.log('[storage] Saved:', inspectionId, 'size:', buffer.length)
}

export async function loadDoc(
  inspectionId: string
): Promise<Buffer> {
  const supabase = getSupabase()
  const path = `${inspectionId}.docx`

  // Generate a unique signed URL each call — the unique JWT token means CDN can never
  // serve a cached copy, so we always get the latest version from storage.
  const { data: signData, error: signError } = await supabase.storage
    .from('reports')
    .createSignedUrl(path, 60)

  if (signError || !signData?.signedUrl) {
    throw new Error('Document not found. Generate it first.')
  }

  // Append a timestamp to bust any intermediate CDN or proxy cache on the
  // signed URL path — Supabase storage ignores unknown query parameters.
  const bustedUrl = `${signData.signedUrl}&t=${Date.now()}`
  const res = await fetch(bustedUrl, { cache: 'no-store' })
  if (!res.ok) {
    if (res.status === 404) throw new Error('Document not found. Generate it first.')
    throw new Error(`Storage download failed: ${res.status}`)
  }
  const arrayBuffer = await res.arrayBuffer()
  console.log('[storage] Loaded:', inspectionId, '—', arrayBuffer.byteLength, 'bytes')
  return Buffer.from(arrayBuffer)
}

export async function deleteDoc(
  inspectionId: string
): Promise<void> {
  const supabase = getSupabase()
  await supabase.storage
    .from('reports')
    .remove([`${inspectionId}.docx`])
  console.log('[storage] Deleted:', inspectionId)
}

// ── FROZEN PDF (finalised reports) ──────────────────────────────────────────
// Same bucket/pattern as the docx — private storage, signed URLs on read so
// a CDN can never serve a stale cached copy.

export async function savePdf(
  inspectionId: string,
  buffer: Buffer
): Promise<void> {
  const supabase = getSupabase()
  const { error } = await supabase.storage
    .from('reports')
    .upload(`${inspectionId}.pdf`, buffer, {
      contentType: 'application/pdf',
      upsert: true,
    })
  if (error) throw new Error('Failed to save PDF: ' + error.message)
  console.log('[storage] Saved PDF:', inspectionId, 'size:', buffer.length)
}

/** Returns a signed URL for the frozen PDF, or null if none exists yet
 *  (e.g. a report finalised before this feature existed). Never throws for
 *  a missing file — callers should treat null as "no frozen PDF". */
export async function getPdfSignedUrl(
  inspectionId: string,
  expiresInSeconds = 3600
): Promise<string | null> {
  const supabase = getSupabase()
  const { data, error } = await supabase.storage
    .from('reports')
    .createSignedUrl(`${inspectionId}.pdf`, expiresInSeconds)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

export async function loadPdf(
  inspectionId: string
): Promise<Buffer> {
  const url = await getPdfSignedUrl(inspectionId, 60)
  if (!url) throw new Error('PDF not found')
  const res = await fetch(`${url}&t=${Date.now()}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Storage download failed: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}
