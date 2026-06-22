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
  const { data, error } = await supabase.storage
    .from('reports')
    .download(`${inspectionId}.docx`)
  if (error || !data) throw new Error('Document not found. Generate it first.')
  const arrayBuffer = await data.arrayBuffer()
  console.log('[storage] Loaded:', inspectionId)
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
