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

// ── MARKUP PDF (drawing + linked photos) ────────────────────────────────────
// Generated in the browser at finalise time and uploaded here, so it can be
// re-opened later without rebuilding it.

export async function saveMarkupPdf(
  inspectionId: string,
  buffer: Buffer
): Promise<void> {
  const supabase = getSupabase()
  const { error } = await supabase.storage
    .from('reports')
    .upload(`${inspectionId}-markup.pdf`, buffer, {
      contentType: 'application/pdf',
      upsert: true,
    })
  if (error) throw new Error('Failed to save markup PDF: ' + error.message)
  console.log('[storage] Saved markup PDF:', inspectionId, 'size:', buffer.length)
}

/** Null rather than throwing when absent — an inspection with no pins never
 *  produces one, which is a normal state, not an error. */
export async function loadMarkupPdf(inspectionId: string): Promise<Buffer | null> {
  const supabase = getSupabase()
  const { data, error } = await supabase.storage
    .from('reports')
    .createSignedUrl(`${inspectionId}-markup.pdf`, 60)
  if (error || !data?.signedUrl) return null
  const res = await fetch(`${data.signedUrl}&t=${Date.now()}`, { cache: 'no-store' })
  if (!res.ok) return null
  return Buffer.from(await res.arrayBuffer())
}

// ── DOCUMENT VERSION / EDITOR KEY ───────────────────────────────────────────
// OnlyOffice treats `document.key` as the *identity of the content*, not of
// the session: for a key it has seen before it ignores `document.url`
// entirely and serves its own cached copy — and that session's saves then
// write the stale copy back over storage. So the key must change whenever
// the stored file changes, and must never be reused for different content.
//
// It is therefore derived from the stored object itself (its ETag, which is
// the content hash, falling back to the modified time and size) rather than
// from anything the browser counts.

/** OnlyOffice accepts only [0-9a-zA-Z-._=] in a key, max 128 chars. */
function sanitiseKeyPart(value: string): string {
  return value.replace(/[^0-9a-zA-Z\-._=]/g, '')
}

export type DocVersion = {
  tag: string
  updatedAt: string | null
  size: number | null
}

/** Identity of the currently-stored `reports/{inspectionId}.docx`, or null
 *  if it doesn't exist yet. Two calls return the same tag only while the
 *  file is byte-for-byte unchanged. */
export async function getDocVersion(inspectionId: string): Promise<DocVersion | null> {
  const supabase = getSupabase()
  const { data } = await supabase.storage
    .from('reports')
    .list('', { search: `${inspectionId}.docx` })

  const entry = data?.find(f => f.name === `${inspectionId}.docx`)
  if (!entry) return null

  const meta: any = entry.metadata ?? {}
  const size: number | null = typeof meta.size === 'number' ? meta.size : null
  const etag: string = typeof meta.eTag === 'string' ? meta.eTag : ''
  const updatedAt: string | null = entry.updated_at ?? null

  // ETag is the object's content hash — the strongest signal available.
  // updated_at alone is only second-resolution in some environments, so two
  // rewrites inside the same second would look identical; size is folded in
  // as a cheap tiebreaker for that fallback.
  const raw = etag
    ? sanitiseKeyPart(etag)
    : sanitiseKeyPart(`${updatedAt ?? ''}-${size ?? 0}`)

  return { tag: raw.slice(0, 64) || String(Date.now()), updatedAt, size }
}

/** The OnlyOffice document key for the stored report, or null if there is
 *  no document yet. Callers must pass this exact string both to the editor
 *  and to any CommandService call (force-save, drop, meta) that targets the
 *  open session. */
export async function getDocKey(inspectionId: string): Promise<string | null> {
  const version = await getDocVersion(inspectionId)
  if (!version) return null
  return `doc-${sanitiseKeyPart(inspectionId)}-${version.tag}`.slice(0, 128)
}
