/** Uploads what was saved on the phone, whenever the engineer's upload
 *  setting allows (lib/offline/uploadMode): when the app opens, when the
 *  signal comes back, after each change, and every minute while anything
 *  is waiting.
 *
 *  Two queues:
 *  - changes (lib/offline/outbox) — visits, mark-ups, note text — sent one
 *    at a time, in order;
 *  - files (lib/offline/files) — photos and recordings — each uploaded on
 *    its own and attached to its note as soon as it's up, so one that fails
 *    never holds back the others or the note itself.
 *
 *  Something that fails for want of signal waits for the next try (with a
 *  growing pause, so a dead connection isn't hammered). Something the
 *  server refuses is tried a few times and then set aside; Profile lists
 *  those with the reason. */

import { AppState } from 'react-native'
import { supabase } from '../supabase'
import { db, getRow, putRow, type Table } from './db'
import { discardFile, ensureUploaded, isLocal, PermanentError } from './files'
import {
  isConnectionError, isOnline, isWifi, markReachable, markUnreachable, onConnectivity, startNetworkWatch, withTimeout,
} from './net'
import {
  completeOp, hasPending, nextOp, onOutboxChange, outboxChanged, queueCounts, recordFailure, setInFlight, type Op,
} from './outbox'
import { allowed, onUploadModeChange, uploadMode, type UploadMode } from './uploadMode'

const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''
const DEFAULT_APP_URL = 'https://www.site-iq.co.nz'
const REQUEST_MS = 30_000
/** Tries before a photo or recording the server refuses is set aside. */
const FILE_TRIES = 3

export type SyncStatus = {
  /** Visits, mark-ups and note changes waiting. */
  changes: number
  /** Photos and recordings waiting. */
  files: number
  /** changes + files. */
  waiting: number
  /** Changes and files the server refused, set aside. */
  failed: number
  /** Why waiting things aren't going up: the setting holds them. */
  held: 'manual' | 'wifi' | null
  mode: UploadMode
  online: boolean
  uploading: boolean
  /** Why the last attempt stopped, readable; null when all is well. */
  problem: string | null
}

let status: SyncStatus = {
  changes: 0, files: 0, waiting: 0, failed: 0, held: null, mode: 'auto', online: true, uploading: false, problem: null,
}
const listeners = new Set<(s: SyncStatus) => void>()

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch }
  listeners.forEach(l => l(status))
}

export function onSyncStatus(listener: (s: SyncStatus) => void): () => void {
  listeners.add(listener)
  listener(status)
  return () => { listeners.delete(listener) }
}

export function getSyncStatus(): SyncStatus { return status }

async function currentUserId(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.user.id ?? null
}

async function refreshCounts() {
  const counts = await queueCounts(await currentUserId())
  const d = await db()
  const f = await d.getFirstAsync<{ waiting: number; failed: number }>(
    `SELECT SUM(CASE WHEN attempts < ? THEN 1 ELSE 0 END) AS waiting,
            SUM(CASE WHEN attempts >= ? THEN 1 ELSE 0 END) AS failed
       FROM files WHERE uploaded = 0 AND kind != 'drawing'`, FILE_TRIES, FILE_TRIES)
  const files = f?.waiting ?? 0
  const mode = await uploadMode()
  const may = allowed(mode, isWifi(), false)
  const heldChanges = counts.waiting > 0 && !may.changes
  const heldFiles = files > 0 && !may.files
  setStatus({
    changes: counts.waiting, files, waiting: counts.waiting + files,
    failed: counts.failed + (f?.failed ?? 0),
    held: heldChanges || heldFiles ? (mode === 'manual' ? 'manual' : 'wifi') : null,
    mode, online: isOnline(),
  })
}

let running: Promise<void> | null = null
let again = false
let timer: ReturnType<typeof setTimeout> | null = null
/** After a failed attempt, the next waits longer: 30 s, doubling to 5 min.
 *  A new connection, the app returning to the front, or Upload now tries
 *  straight away. */
let backoffMs = 0
let notBefore = 0
/** Upload now tapped while a pass was running: the next pass is manual too. */
let manualAgain = false
const BACKOFF_MIN = 30_000
const BACKOFF_MAX = 300_000

function resetBackoff() { backoffMs = 0; notBefore = 0 }

function failedAttempt() {
  backoffMs = backoffMs ? Math.min(BACKOFF_MAX, backoffMs * 2) : BACKOFF_MIN
  notBefore = Date.now() + backoffMs
  syncSoon(backoffMs + 200)
}

/** Starts an upload pass, or queues one after the pass already running.
 *  `manual` is the engineer tapping Upload now: everything goes, whatever
 *  the setting, and any pause after a failure is skipped. */
export function syncNow({ manual = false }: { manual?: boolean } = {}): Promise<void> {
  if (manual) resetBackoff()
  if (!manual && Date.now() < notBefore) return Promise.resolve()
  if (running) { again = true; if (manual) manualAgain = true; return running }
  running = (async () => {
    try {
      let m = manual
      do { again = false; await pass(m); m = manualAgain; manualAgain = false } while (again && isOnline())
    } finally {
      running = null
      setInFlight(null)
      await refreshCounts().catch(() => {})
    }
  })()
  return running
}

function syncSoon(ms = 800) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { timer = null; syncNow() }, ms)
}

let started = false
/** Wires the queues to the app's life: call once, at the root. */
export function startSync(): void {
  if (started) return
  started = true
  startNetworkWatch()
  onConnectivity(online => {
    refreshCounts().catch(() => {})
    if (online) { resetBackoff(); syncSoon(1500) }
  })
  onOutboxChange(() => { refreshCounts().catch(() => {}); if (Date.now() >= notBefore) syncSoon() })
  onUploadModeChange(() => { refreshCounts().catch(() => {}); resetBackoff(); syncSoon(300) })
  AppState.addEventListener('change', s => { if (s === 'active') { resetBackoff(); syncSoon(500) } })
  setInterval(() => {
    refreshCounts().catch(() => {})
    if (status.waiting > 0 && isOnline()) syncNow()
  }, 60_000)
  // Signing in (or the token refreshing) can unblock waiting uploads.
  supabase.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') syncSoon(1000)
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') refreshCounts().catch(() => {})
  })
  refreshCounts().catch(() => {})
  syncSoon(2000)
}

/** Lets the file queue know a photo or recording was added. */
export function filesChanged(): void {
  refreshCounts().catch(() => {})
  if (Date.now() >= notBefore) syncSoon()
}

async function pass(manual: boolean): Promise<void> {
  const owner = await currentUserId()
  if (!owner || !isOnline()) return
  const may = allowed(await uploadMode(), isWifi(), manual)
  if (!may.changes && !may.files) return
  setStatus({ uploading: true })
  try {
    if (may.changes && !(await sendChanges(owner))) return
    if (may.files) await sendFiles()
  } finally {
    setStatus({ uploading: false })
  }
}

/** Sends waiting changes in order. False if it stopped on a failure. */
async function sendChanges(owner: string): Promise<boolean> {
  for (;;) {
    if (!isOnline()) return false
    const op = await nextOp(owner)
    if (!op) { setStatus({ problem: null }); return true }
    setInFlight(op.seq)
    try {
      await run(op)
      await completeOp(op.seq)
      await markSynced(op)
      markReachable()
      backoffMs = 0
      setStatus({ problem: null })
    } catch (err: any) {
      const permanent = err instanceof PermanentError
      console.warn(`[sync] ${op.kind} ${op.target}:`, err?.message ?? err)
      if (!permanent && isConnectionError(err)) markUnreachable()
      await recordFailure(op.seq, err?.message ?? String(err), permanent)
      setStatus({ problem: permanent ? `Couldn't upload a change: ${err?.message}` : 'Waiting for a better signal…' })
      failedAttempt()
      return false
    } finally {
      setInFlight(null)
    }
  }
}

/** Notes (on the phone) listing a photo or recording. */
async function notesUsing(local: string): Promise<{ id: string }[]> {
  const d = await db()
  return d.getAllAsync<{ id: string }>(
    "SELECT id FROM rows WHERE tbl = 'observations' AND data LIKE ?", `%${JSON.stringify(local).slice(1, -1)}%`)
}

/** Uploads waiting photos and recordings, each attached to its note as
 *  soon as it's up. */
async function sendFiles(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) return
  const d = await db()
  const files = await d.getAllAsync<{ local: string; created_at: number }>(
    `SELECT local, created_at FROM files WHERE uploaded = 0 AND kind != 'drawing' AND attempts < ? ORDER BY created_at`, FILE_TRIES)
  for (const f of files) {
    if (!isOnline()) return
    const notes = await notesUsing(f.local)
    if (!notes.length) {
      // On no note (it was deleted), and not in a waiting change either:
      // nothing will ever use it. Kept a day in case.
      const queued = await d.getFirstAsync('SELECT seq FROM outbox WHERE payload LIKE ?', `%${JSON.stringify(f.local).slice(1, -1)}%`)
      if (!queued && Date.now() - f.created_at > 86400_000) await discardFile(f.local)
      continue
    }
    try {
      await ensureUploaded(f.local, token, SUPABASE_KEY)
      markReachable()
    } catch (err: any) {
      const permanent = err instanceof PermanentError
      console.warn('[sync] file', f.local, err?.message ?? err)
      if (!permanent) {
        if (isConnectionError(err)) markUnreachable()
        setStatus({ problem: 'Waiting for a better signal…' })
        failedAttempt()
        return
      }
      await d.runAsync('UPDATE files SET attempts = attempts + 1, last_error = ? WHERE local = ?',
        String(err?.message ?? err).slice(0, 500), f.local)
      continue
    }
    for (const n of notes) {
      try { await attachUploads(n.id) }
      catch (err: any) {
        console.warn('[sync] attach', n.id, err?.message ?? err)
        if (!(err instanceof PermanentError)) { failedAttempt(); return }
      }
    }
    refreshCounts().catch(() => {})
  }
}

/** Puts a note's uploaded photos and recordings on the server's copy, and
 *  swaps their local paths for web addresses on the phone's. A note whose
 *  first save hasn't gone up yet is left: that save takes them along. */
async function attachUploads(id: string): Promise<void> {
  const d = await db()
  const insertWaiting = await d.getFirstAsync('SELECT seq FROM outbox WHERE target = ? AND kind = ?', id, 'observation.insert')
  if (insertWaiting) return
  const row = await getRow('observations', id)
  if (!row) return
  const lists = (['photos', 'audio'] as const).filter(k => Array.isArray(row[k]))
  const swapped: Record<string, string[]> = {}
  for (const k of lists) swapped[k] = await Promise.all(row[k].map(uploadedOr))
  const server: Record<string, string[]> = {}
  for (const k of lists) server[k] = swapped[k].filter(u => !isLocal(u))
  await saveRow('observation.update', id, server)
  const fresh = await getRow('observations', id)
  if (fresh) {
    const next = { ...fresh }
    for (const k of lists) if (Array.isArray(fresh[k])) next[k] = await Promise.all(fresh[k].map(uploadedOr))
    await putRow('observations', next)
  }
}

/** A file's web address if it's uploaded, otherwise its local path. */
async function uploadedOr(uri: string): Promise<string> {
  if (!isLocal(uri)) return uri
  const d = await db()
  const r = await d.getFirstAsync<{ remote: string; uploaded: number }>('SELECT remote, uploaded FROM files WHERE local = ?', uri)
  return r?.uploaded ? r.remote : uri
}

const TABLE: Record<string, Table> = { inspection: 'inspections', zone: 'zones', observation: 'observations' }

/** Once nothing about a row is left to send, the phone's copy is no longer
 *  "pending" and server refreshes may update it again. */
async function markSynced(op: Op) {
  const tbl = TABLE[op.kind.split('.')[0]]
  if (op.kind.endsWith('.delete') || !tbl) return
  if (await hasPending(op.target)) return
  const row = await getRow(tbl, op.target)
  if (row) {
    const { _pending, ...rest } = row
    await putRow(tbl, { ...rest, _sent: true })
  }
}

/** A server refusal ("permanent") versus a signal problem (worth retrying). */
function check(res: { error: any; status: number }, what: string) {
  if (!res.error) return
  const s = res.status
  if (s === 0 || s >= 500 || s === 401 || s === 408 || s === 429 || !res.error.code) {
    if (s === 401) supabase.auth.refreshSession().catch(() => {})
    throw new Error(`${what}: ${res.error.message ?? 'no response'}`)
  }
  throw new PermanentError(`${what}: ${res.error.message}`)
}

const isDuplicate = (res: { error: any }) => res.error?.code === '23505'

async function run(op: Op): Promise<void> {
  const p = op.payload
  switch (op.kind) {
    case 'inspection.insert': {
      const row = { ...p, report_no: await freeReportNo(p) }
      let res = await withTimeout(supabase.from('inspections').insert(row), REQUEST_MS)
      if (isDuplicate(res)) {
        const { id, ...fields } = row
        res = await withTimeout(supabase.from('inspections').update(fields).eq('id', id), REQUEST_MS)
      }
      check(res, 'Saving the site visit')
      if (row.report_no !== p.report_no) {
        // Another visit took this number while the phone was offline.
        const local = await getRow('inspections', p.id)
        if (local) await putRow('inspections', { ...local, report_no: row.report_no })
      }
      return
    }
    case 'inspection.update': {
      check(await withTimeout(supabase.from('inspections').update(p).eq('id', op.target), REQUEST_MS), 'Updating the site visit')
      return
    }
    case 'inspection.delete': {
      await callApi('/api/reports/delete', { inspectionId: op.target })
      return
    }
    case 'zone.insert': {
      const res = await withTimeout(supabase.from('zones').insert(p), REQUEST_MS)
      if (!isDuplicate(res)) check(res, 'Saving a drawing mark-up')
      return
    }
    case 'zone.delete': {
      check(await withTimeout(supabase.from('observations').update({ zone_id: null }).eq('zone_id', op.target), REQUEST_MS), 'Unlinking notes from a mark-up')
      check(await withTimeout(supabase.from('zones').delete().eq('id', op.target), REQUEST_MS), 'Deleting a mark-up')
      return
    }
    case 'observation.insert':
    case 'observation.update': {
      // Photos and recordings already uploaded go along; the rest are
      // attached by the file queue as each one goes up.
      const fields = { ...p }
      for (const k of ['photos', 'audio']) {
        if (Array.isArray(fields[k])) fields[k] = (await Promise.all(fields[k].map(uploadedOr))).filter((u: string) => !isLocal(u))
      }
      await saveRow(op.kind, op.target, fields)
      return
    }
    case 'observation.delete': {
      await callApi('/api/notes/delete', { observationId: op.target }, true)
      return
    }
  }
}

async function saveRow(kind: string, id: string, fields: Record<string, any>) {
  const attempt = async (f: Record<string, any>) => {
    if (kind === 'observation.insert') {
      const res = await withTimeout(supabase.from('observations').insert(f), REQUEST_MS)
      if (!isDuplicate(res)) return res
      const { id: _id, ...rest } = f
      return withTimeout(supabase.from('observations').update(rest).eq('id', id), REQUEST_MS)
    }
    return withTimeout(supabase.from('observations').update(f).eq('id', id), REQUEST_MS)
  }
  let res = await attempt(fields)
  // Before web/sql/observation_audio.sql has run there's no audio column.
  if (res.error && /\baudio\b/.test(res.error.message ?? '') && 'audio' in fields) {
    const { audio, ...rest } = fields
    res = await attempt(rest)
  }
  check(res, 'Saving a site note')
}

/** The report number the phone gave a new visit, or the next free one if
 *  another visit on the project took it meanwhile. */
async function freeReportNo(row: any): Promise<string> {
  const res = await withTimeout(
    supabase.from('inspections').select('id, report_no').eq('project_id', row.project_id), REQUEST_MS)
  check(res as any, 'Checking report numbers')
  const others = ((res as any).data ?? []).filter((r: any) => r.id !== row.id)
  if (!others.some((r: any) => String(r.report_no).trim() === String(row.report_no).trim())) return row.report_no
  const highest = Math.max(others.length, ...others.map((r: any) => parseInt(r.report_no, 10) || 0))
  return String(highest + 1).padStart(3, '0')
}

function apiBase(): string {
  const raw = (process.env.EXPO_PUBLIC_APP_URL ?? DEFAULT_APP_URL).trim().replace(/\/+$/, '')
  return raw.replace(/^https:\/\/site-iq\.co\.nz/i, DEFAULT_APP_URL)
}

async function callApi(path: string, body: object, notFoundIsDone = false) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')
  const res = await withTimeout(fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  }), REQUEST_MS)
  if (res.ok || (notFoundIsDone && res.status === 404)) return
  const detail = await res.json().catch(() => ({} as any))
  const message = detail?.error ?? `Request failed (${res.status})`
  if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 408 && res.status !== 429) {
    throw new PermanentError(message)
  }
  throw new Error(message)
}

/** Photos and recordings the server refused, with the reason. */
export async function failedFiles(): Promise<{ local: string; kind: string; last_error: string | null }[]> {
  const d = await db()
  return d.getAllAsync('SELECT local, kind, last_error FROM files WHERE uploaded = 0 AND kind != ? AND attempts >= ?', 'drawing', FILE_TRIES)
}

/** Gives refused photos and recordings another go. */
export async function retryFailedFiles(): Promise<void> {
  const d = await db()
  await d.runAsync('UPDATE files SET attempts = 0 WHERE uploaded = 0')
  outboxChanged()
}
