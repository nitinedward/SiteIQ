/**
 * Server-side download of a file kept in this project's Supabase storage,
 * authorised with the service key.
 *
 * The key reads and writes every firm's data, so it must only ever go to
 * our own storage. Template addresses are stored on rows a firm's users can
 * edit, so an address is checked here before the key is attached: anything
 * that isn't this project's storage is refused rather than fetched — a
 * template pointed at another server would otherwise be sent the key.
 */

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co').replace(/\/$/, '')

/** True for an address inside this project's Supabase storage. */
export function isOurStorageUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false
  try {
    const u = new URL(url)
    const ours = new URL(SUPABASE_URL)
    return u.protocol === 'https:' && u.host === ours.host && u.pathname.startsWith('/storage/v1/object/')
  } catch {
    return false
  }
}

export async function fetchFromOurStorage(url: string, init: RequestInit = {}): Promise<Response> {
  if (!isOurStorageUrl(url)) {
    throw new Error('Refusing to fetch a file outside SiteIQ storage')
  }
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()}`)
  return fetch(url, { ...init, headers })
}
