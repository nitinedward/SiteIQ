import { supabase } from './supabase';

const DEFAULT_APP_URL = 'https://www.site-iq.co.nz';

/** The apex 308-redirects to www; posting straight to www keeps the body
 *  off a redirect hop. Matches lib/firm.ts. */
function apiBase(): string {
  const raw = (process.env.EXPO_PUBLIC_APP_URL ?? DEFAULT_APP_URL).trim().replace(/\/+$/, '');
  return raw.replace(/^https:\/\/site-iq\.co\.nz/i, DEFAULT_APP_URL);
}

async function post(path: string, body: Record<string, unknown>): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Please sign in again.');

  const res = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result?.error ?? 'Could not delete. Please try again.');
}

/**
 * Deletes a site note through the server, so its photos and response
 * attachments go with it.
 *
 * Deleting the row straight from here would leave those files in the bucket
 * with nothing left to say where they belong — removing them needs the
 * service key, which only the server holds.
 */
export const deleteSiteNote = (observationId: string) =>
  post('/api/notes/delete', { observationId });

/** Deletes a report and everything recorded on it, files included. */
export const deleteReport = (inspectionId: string) =>
  post('/api/reports/delete', { inspectionId });
