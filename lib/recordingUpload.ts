/** Keeping a note's dictation: the recordings go up beside its photos and
 *  are listed on the note (observations.audio — web/sql/observation_audio.sql),
 *  as a record of what was said on site and so they can be transcribed again
 *  later. */

import { supabase } from './supabase'

const SUPABASE_URL = 'https://vbaewualqaxhbmqgnhdt.supabase.co'
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

/** Uploads one recording; returns its URL, or throws. */
export async function uploadRecording(localUri: string): Promise<string> {
  const name = `audio/dictation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`
  const fd = new FormData()
  fd.append('file', { uri: localUri, name: name.split('/').pop(), type: 'audio/wav' } as any)
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token ?? SUPABASE_KEY
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/observation-photos/${name}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY },
    body: fd,
  })
  if (!res.ok) throw new Error(`Recording upload failed (${res.status})`)
  return `${SUPABASE_URL}/storage/v1/object/public/observation-photos/${name}`
}

/** Whether a save failed only because observations.audio doesn't exist yet
 *  (observation_audio.sql not run), so it can be saved again without it. */
export function isMissingAudioColumn(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false
  return error.code === 'PGRST204' || error.code === '42703' || /\baudio\b/.test(error.message ?? '')
}
