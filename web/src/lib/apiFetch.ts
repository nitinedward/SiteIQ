import { supabase } from '@/lib/supabase'

/**
 * fetch() for this app's own API routes, carrying the signed-in user's
 * token. The routes check it against the firm that owns what is asked for
 * (lib/apiAuth), so a call without it is refused.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = new Headers(init.headers)
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`)
  return fetch(input, { ...init, headers })
}
