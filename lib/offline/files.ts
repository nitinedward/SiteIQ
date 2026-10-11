/** Photos, recordings and drawings kept on the phone.
 *
 *  A photo or recording is saved here first and listed on its note by its
 *  local path; the upload queue (lib/offline/sync) sends it up and swaps the
 *  path for its web address. Each file is given its web address when it's
 *  saved, so an upload cut short and tried again lands in the same place
 *  rather than leaving a duplicate.
 *
 *  Once uploaded, the local copy is kept a while so the phone still shows it
 *  with no signal — localFor() maps a web address back to it. */

import * as FileSystem from 'expo-file-system/legacy'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { randomUUID } from 'expo-crypto'
import { db } from './db'

export const SUPABASE_URL = 'https://vbaewualqaxhbmqgnhdt.supabase.co'
const BUCKET = 'observation-photos'
const DIR = `${FileSystem.documentDirectory}offline/`

/** Long side of a photo as uploaded. Plenty for a report page, and about a
 *  tenth of a phone camera's full-size file. */
const PHOTO_MAX_PX = 2000
/** Uploaded files are kept on the phone this long, then tidied away. */
const KEEP_DAYS = 14

export type FileKind = 'photo' | 'audio' | 'drawing'

/** web address → local path, for showing files without signal. */
const byRemote = new Map<string, string>()
let loaded: Promise<void> | null = null

export function loadFileIndex(): Promise<void> {
  if (!loaded) loaded = (async () => {
    const d = await db()
    const rows = await d.getAllAsync<{ local: string; remote: string }>('SELECT local, remote FROM files')
    rows.forEach(r => byRemote.set(r.remote, r.local))
  })()
  return loaded
}

/** The phone's copy of a file, if it has one; otherwise the address as given. */
export function localFor(uri: string): string {
  return byRemote.get(uri) ?? uri
}

export function isLocal(uri: string): boolean {
  return uri.startsWith('file:')
}

function publicUrl(path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`
}

async function register(local: string, remote: string, kind: FileKind, uploaded = false): Promise<void> {
  const d = await db()
  await d.runAsync(
    'INSERT OR REPLACE INTO files (local, remote, kind, uploaded, created_at, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)',
    local, remote, kind, uploaded ? 1 : 0, Date.now(), uploaded ? Date.now() : null)
  byRemote.set(remote, local)
}

/** Saves a photo for a note: scaled down if it's larger than needed, kept in
 *  the app's folder. Returns its local path, which goes on the note. */
export async function savePhoto(uri: string, size?: { width?: number; height?: number }): Promise<string> {
  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {})
  const long = Math.max(size?.width ?? 0, size?.height ?? 0)
  const resize = long > PHOTO_MAX_PX
    ? [{ resize: (size!.width ?? 0) >= (size!.height ?? 0) ? { width: PHOTO_MAX_PX } : { height: PHOTO_MAX_PX } }]
    : []
  const out = await manipulateAsync(uri, resize, { compress: 0.7, format: SaveFormat.JPEG })
  const name = `photo-${Date.now()}-${randomUUID().slice(0, 8)}.jpg`
  const local = `${DIR}${name}`
  await FileSystem.moveAsync({ from: out.uri, to: local })
  await register(local, publicUrl(name), 'photo')
  return local
}

/** Takes a dictation recording (a WAV from lib/dictation) under the queue's
 *  care. Returns the path to list on the note. */
export async function keepRecording(wavUri: string): Promise<string> {
  const name = `audio/dictation-${Date.now()}-${randomUUID().slice(0, 8)}.wav`
  await register(wavUri, publicUrl(name), 'audio')
  return wavUri
}

/** Uploads a local file if it hasn't been already; returns its web address. */
export async function ensureUploaded(local: string, token: string, apikey: string): Promise<string> {
  const d = await db()
  const row = await d.getFirstAsync<{ remote: string; uploaded: number; kind: FileKind }>(
    'SELECT remote, uploaded, kind FROM files WHERE local = ?', local)
  if (!row) throw new PermanentError('A photo or recording on this note is missing from the phone.')
  if (row.uploaded) return row.remote

  const info = await FileSystem.getInfoAsync(local)
  if (!info.exists) throw new PermanentError('A photo or recording on this note is missing from the phone.')

  const path = row.remote.split(`/public/${BUCKET}/`)[1]
  const result = await FileSystem.uploadAsync(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, local, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      Authorization: `Bearer ${token}`,
      apikey,
      'Content-Type': row.kind === 'audio' ? 'audio/wav' : 'image/jpeg',
      // Same address every attempt: one cut short and retried replaces
      // its own partial copy rather than failing as a duplicate.
      'x-upsert': 'true',
    },
  })
  if (result.status < 200 || result.status >= 300) {
    const err = new Error(`Upload failed (${result.status})`)
    if (result.status >= 400 && result.status < 500 && result.status !== 401 && result.status !== 408 && result.status !== 429) {
      throw new PermanentError(`${err.message}: ${result.body?.slice(0, 200) ?? ''}`)
    }
    throw err
  }
  await d.runAsync('UPDATE files SET uploaded = 1, uploaded_at = ? WHERE local = ?', Date.now(), local)
  return row.remote
}

/** A drawing's image for offline use: downloaded once, kept by its web
 *  address (a revised sheet is a new drawing with a new address). */
export async function downloadDrawing(remote: string): Promise<number> {
  if (byRemote.has(remote)) {
    const info = await FileSystem.getInfoAsync(byRemote.get(remote)!)
    if (info.exists) return info.size ?? 0
  }
  await FileSystem.makeDirectoryAsync(`${DIR}drawings/`, { intermediates: true }).catch(() => {})
  const ext = (remote.split('?')[0].match(/\.(png|jpe?g|webp)$/i)?.[1] ?? 'png').toLowerCase()
  const local = `${DIR}drawings/${randomUUID()}.${ext}`
  const res = await FileSystem.downloadAsync(remote, local)
  if (res.status !== 200) {
    await FileSystem.deleteAsync(local, { idempotent: true })
    throw new Error(`Drawing download failed (${res.status})`)
  }
  await register(local, remote, 'drawing', true)
  const info = await FileSystem.getInfoAsync(local)
  return info.exists ? info.size ?? 0 : 0
}

export async function forgetDrawing(remote: string): Promise<void> {
  const local = byRemote.get(remote)
  if (!local) return
  const d = await db()
  await d.runAsync('DELETE FROM files WHERE local = ?', local)
  byRemote.delete(remote)
  await FileSystem.deleteAsync(local, { idempotent: true })
}

/** Removes a photo or recording that never needs uploading (its note was
 *  thrown away before it went up). */
export async function discardFile(local: string): Promise<void> {
  const d = await db()
  const row = await d.getFirstAsync<{ remote: string }>('SELECT remote FROM files WHERE local = ?', local)
  await d.runAsync('DELETE FROM files WHERE local = ?', local)
  if (row) byRemote.delete(row.remote)
  await FileSystem.deleteAsync(local, { idempotent: true })
}

/** Tidies uploaded photos and recordings off the phone after KEEP_DAYS.
 *  Drawings stay while their project is kept offline. */
export async function tidyFiles(): Promise<void> {
  const d = await db()
  const cutoff = Date.now() - KEEP_DAYS * 86400_000
  const old = await d.getAllAsync<{ local: string; remote: string }>(
    `SELECT local, remote FROM files WHERE kind != 'drawing' AND uploaded = 1 AND uploaded_at < ?
       AND local NOT IN (SELECT audio FROM transcribe_jobs)`, cutoff)
  for (const f of old) {
    await FileSystem.deleteAsync(f.local, { idempotent: true }).catch(() => {})
    await d.runAsync('DELETE FROM files WHERE local = ?', f.local)
    byRemote.delete(f.remote)
  }
}

/** An upload that will never succeed as it stands, as opposed to one that
 *  only needs a better signal. */
export class PermanentError extends Error {}
