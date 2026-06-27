import { createClient } from '@supabase/supabase-js'

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
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
  console.log('[storage] Saved:', inspectionId)
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

  const res = await fetch(signData.signedUrl, { cache: 'no-store' })
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
