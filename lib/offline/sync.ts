/** Uploads the changes made on the phone (lib/offline/outbox), one at a
 *  time and in order, whenever there's a connection: when the app opens,
 *  when the signal comes back, after each change, and every minute while
 *  anything is waiting.
 *
 *  A change that fails for want of signal waits for the next try. One the
 *  server refuses is tried a few times more and then set aside as failed,
 *  so it can't hold up everything behind it; Profile lists those. */

import { AppState } from 'react-native'
import { supabase } from '../supabase'
import { db, getRow, putRow, type Table } from './db'
import { ensureUploaded, isLocal, PermanentError } from './files'
import { isOnline, onConnectivity, startNetworkWatch, withTimeout } from './net'
import {
  completeOp, hasPending, nextOp, onOutboxChange, queueCounts, recordFailure, setInFlight,
  type Op, type QueueCounts,
} from './outbox'

const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''
const DEFAULT_APP_URL = 'https://www.site-iq.co.nz'
const REQUEST_MS = 30_000

export type SyncStatus = QueueCounts & {
  online: boolean
  uploading: boolean
  /** Why the last attempt stopped, readable; null when all is well. */
  problem: string | null
}

let status: SyncStatus = { waiting: 0, failed: 0, inspections: [], online: true, uploading: false, problem: null }
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
  setStatus({ ...counts, online: isOnline() })
}

let running: Promise<void> | null = null
let again = false
let timer: ReturnType<typeof setTimeout> | null = null

/** Starts an upload pass, or queues one after the pass already running. */
export function syncNow(): Promise<void> {
  if (running) { again = true; return running }
  running = (async () => {
    try {
      do { again = false; await pass() } while (again && isOnline())
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
/** Wires the queue to the app's life: call once, at the root. */
export function startSync(): void {
  if (started) return
  started = true
  startNetworkWatch()
  onConnectivity(online => { setStatus({ online }); if (online) syncSoon(1500) })
  onOutboxChange(() => { refreshCounts().catch(() => {}); syncSoon() })
  AppState.addEventListener('change', s => { if (s === 'active') syncSoon(500) })
  setInterval(() => { if (status.waiting > 0 && isOnline()) syncNow() }, 60_000)
  // Signing in (or the token refreshing) can unblock waiting changes.
  supabase.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') syncSoon(1000)
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') refreshCounts().catch(() => {})
  })
  refreshCounts().catch(() => {})
  syncSoon(2000)
}

async function pass(): Promise<void> {
  const owner = await currentUserId()
  if (!owner || !isOnline()) return
  setStatus({ uploading: true })
  try {
    for (;;) {
      if (!isOnline()) break
      const op = await nextOp(owner)
      if (!op) { setStatus({ problem: null }); break }
      setInFlight(op.seq)
      try {
        await run(op)
        await completeOp(op.seq)
        await markSynced(op)
        setStatus({ problem: null })
      } catch (err: any) {
        const permanent = err instanceof PermanentError
        console.warn(`[sync] ${op.kind} ${op.target}:`, err?.message ?? err)
        await recordFailure(op.seq, err?.message ?? String(err), permanent)
        setStatus({ problem: permanent ? `Couldn't upload a change: ${err?.message}` : 'Waiting for a better signal…' })
        break
      } finally {
        setInFlight(null)
      }
    }
  } finally {
    setStatus({ uploading: false })
  }
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
      await sendObservation(op)
      return
    }
    case 'observation.delete': {
      await callApi('/api/notes/delete', { observationId: op.target }, true)
      return
    }
  }
}

/** A note goes up in two steps so the office sees it soon: first its text
 *  (with any photos already uploaded), then its remaining photos and
 *  recordings, then the full lists. Cut short anywhere, it's simply sent
 *  again — the insert becomes an update and finished uploads are skipped. */
async function sendObservation(op: Op) {
  const p = { ...op.payload }
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('Not signed in')

  const d = await db()
  const uploadedUrl = async (uri: string) => {
    if (!isLocal(uri)) return uri
    const r = await d.getFirstAsync<{ remote: string; uploaded: number }>('SELECT remote, uploaded FROM files WHERE local = ?', uri)
    return r?.uploaded ? r.remote : null
  }
  const lists = ['photos', 'audio'].filter(k => Array.isArray(p[k])) as ('photos' | 'audio')[]
  const firstStep: Record<string, any> = { ...p }
  for (const k of lists) {
    firstStep[k] = (await Promise.all(p[k].map(uploadedUrl))).filter(Boolean)
  }
  await saveRow(op, firstStep)

  const needsFiles = lists.some(k => p[k].some(isLocal))
  if (!needsFiles) return

  const full: Record<string, any> = {}
  const uploaded = new Map<string, string>()
  for (const k of lists) {
    full[k] = []
    for (const uri of p[k]) {
      const url = isLocal(uri) ? await ensureUploaded(uri, token, SUPABASE_KEY) : uri
      if (url !== uri) uploaded.set(uri, url)
      full[k].push(url)
    }
  }
  await saveRow({ ...op, kind: 'observation.update' }, full)

  // The phone's copy lists the web addresses from now on (the files stay on
  // the phone a while, and localFor() still finds them). Swapped one by
  // one, so a photo added since this change was queued isn't lost.
  const local = await getRow('observations', op.target)
  if (local) {
    const swapped = { ...local }
    for (const k of lists) if (Array.isArray(local[k])) swapped[k] = local[k].map((u: string) => uploaded.get(u) ?? u)
    await putRow('observations', swapped)
  }
}

async function saveRow(op: Op, fields: Record<string, any>) {
  const attempt = async (f: Record<string, any>) => {
    if (op.kind === 'observation.insert') {
      const res = await withTimeout(supabase.from('observations').insert(f), REQUEST_MS)
      if (!isDuplicate(res)) return res
      const { id, ...rest } = f
      return withTimeout(supabase.from('observations').update(rest).eq('id', op.target), REQUEST_MS)
    }
    return withTimeout(supabase.from('observations').update(f).eq('id', op.target), REQUEST_MS)
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

