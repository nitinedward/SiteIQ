import { supabase } from '@/lib/supabase'
import { apiFetch } from '@/lib/apiFetch'

/** POSTs JSON to a close-out route; throws its error message on failure. */
export async function closeoutPost<T = any>(route: string, body: unknown): Promise<T> {
  const res = await apiFetch(`/api/closeout/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`)
  return data as T
}

/** Uploads a close-out file straight to private storage on a one-time link
 *  from /api/closeout/upload, returning its path for the route that records
 *  it. */
export async function uploadCloseoutFile(
  kind: 'ps1' | 'ps4form' | 'signature',
  file: File,
  extra: { projectId?: string; authorId?: string } = {},
): Promise<string> {
  const ext = /\.jpe?g$/i.test(file.name) || file.type === 'image/jpeg' ? 'jpg' : 'png'
  const { path, token } = await closeoutPost<{ path: string; token: string }>('upload', { kind, ext, ...extra })
  const { error } = await supabase.storage.from('reports').uploadToSignedUrl(path, token, file, {
    contentType: file.type || (kind === 'signature' ? `image/${ext === 'jpg' ? 'jpeg' : 'png'}` : 'application/pdf'),
  })
  if (error) throw new Error('Upload failed: ' + error.message)
  return path
}

/** A ten-minute link to a close-out file. */
export async function closeoutFileUrl(query: string): Promise<string> {
  const res = await apiFetch(`/api/closeout/file?${query}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.url) throw new Error(data.error ?? 'Could not open the file')
  return data.url
}
