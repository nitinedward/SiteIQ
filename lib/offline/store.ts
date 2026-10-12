/** What the screens read and write, instead of talking to the server
 *  directly — so the app works the same with or without signal.
 *
 *  Reading: the phone's copy comes back at once, and when there's a
 *  connection the server's is fetched behind it; if that differs, `onFresh`
 *  is called with the updated rows. Only something never seen on this phone
 *  waits for the server.
 *
 *  Writing: the change is saved on the phone first and queued for upload
 *  (lib/offline/sync), so saving never waits on the signal. New rows get
 *  their ids here, so a note can be added to a visit that hasn't reached
 *  the server yet. */

import { randomUUID } from 'expo-crypto'
import { supabase } from '../supabase'
import {
  deleteRow, getMeta, getRow, getRows, putRow, replaceRows, serverFields, setMeta, db,
} from './db'
import { discardFile, isLocal } from './files'
import { isConnectionError, isOnline, markUnreachable, withTimeout } from './net'
import { dropInspection, dropTarget, enqueue, neverSent } from './outbox'
import { noteRefs } from '../noteRefs'

const READ_MS = 12_000

export type Fresh<T> = ((value: T) => void) | undefined

/** Runs a server query; throws on any error, so a failed refresh never
 *  wipes what's on the phone. */
async function q<T>(query: PromiseLike<{ data: T | null; error: any }>): Promise<T> {
  try {
    const { data, error } = await withTimeout(query, READ_MS)
    if (error) throw new Error(error.message)
    return (data ?? []) as T
  } catch (err) {
    if (isConnectionError(err)) markUnreachable()
    throw err
  }
}

async function read<T>(
  scope: string,
  local: () => Promise<T>,
  refresh: () => Promise<void>,
  onFresh: Fresh<T>,
  isEmpty: (v: T) => boolean = v => Array.isArray(v) ? v.length === 0 : v == null,
): Promise<T> {
  const before = await local()
  const seen = !isEmpty(before) || (await getMeta(`fetched:${scope}`))
  const fetchFresh = async () => {
    await refresh()
    await setMeta(`fetched:${scope}`, Date.now())
    return local()
  }
  if (seen) {
    if (isOnline()) {
      fetchFresh().then(after => {
        if (onFresh && JSON.stringify(after) !== JSON.stringify(before)) onFresh(after)
      }).catch(err => console.warn(`[store] refresh ${scope}:`, err?.message ?? err))
    }
    return before
  }
  if (!isOnline()) return before
  try { return await fetchFresh() }
  catch (err: any) { console.warn(`[store] load ${scope}:`, err?.message ?? err); return before }
}

// ── Who's signed in ───────────────────────────────────────────────────────

export async function myId(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.user.id ?? null
}

export type Profile = { userId: string; email: string; name: string; role: 'admin' | 'member' | null; firmId: string | null; firmName: string }

/** The signed-in engineer and their firm, remembered for use offline. */
export async function myProfile(onFresh?: Fresh<Profile | null>): Promise<Profile | null> {
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) return null
  const key = `profile:${user.id}`
  const refresh = async () => {
    const m = await q<any>(supabase.from('firm_members').select('full_name, role, firm_id').eq('user_id', user.id).single())
    const f = m?.firm_id ? await q<any>(supabase.from('firms').select('id, name').eq('id', m.firm_id).single()) : null
    await setMeta(key, {
      userId: user.id, email: user.email ?? '', name: m?.full_name ?? '',
      role: m?.role ?? null, firmId: f?.id ?? null, firmName: f?.name ?? '',
    })
  }
  return read<Profile | null>(key, () => getMeta<Profile>(key), refresh, onFresh)
}

// ── Projects ──────────────────────────────────────────────────────────────

export async function listProjects(onFresh?: Fresh<any[]>): Promise<any[]> {
  const local = async () => sortNewest(await getRows('projects'))
  const refresh = async () => {
    const me = await myProfile()
    if (!me?.firmId) return
    let rows: any[]
    if (me.role === 'admin') {
      rows = await q(supabase.from('projects').select('*').eq('firm_id', me.firmId))
    } else {
      const assigned = await q<any[]>(supabase.from('project_members').select('project_id').eq('user_id', me.userId))
      const ids = assigned.map(a => a.project_id)
      rows = ids.length ? await q(supabase.from('projects').select('*').in('id', ids)) : []
    }
    await replaceRows('projects', await getRows('projects'), rows)
  }
  return read('projects', local, refresh, onFresh)
}

export async function getProject(id: string, onFresh?: Fresh<any>): Promise<any | null> {
  const refresh = async () => {
    const row = await q(supabase.from('projects').select('*').eq('id', id).single())
    await putRow('projects', row)
  }
  return read(`project:${id}`, () => getRow('projects', id), refresh, onFresh)
}

export type ProjectStats = Record<string, { reports: number; photos: number; drawings: number }>

/** Report, photo and drawing counts for the project cards. */
export async function projectStats(ids: string[], onFresh?: Fresh<ProjectStats>): Promise<ProjectStats> {
  const refresh = async () => {
    if (!ids.length) return
    const insp = await q<any[]>(supabase.from('inspections').select('id, project_id, status').in('project_id', ids))
    const draw = await q<any[]>(supabase.from('drawings').select('project_id').in('project_id', ids))
    const toProject = new Map(insp.map(i => [i.id, i.project_id]))
    const obs = insp.length ? await q<any[]>(supabase.from('observations').select('inspection_id, photos').in('inspection_id', insp.map(i => i.id))) : []
    const stats: ProjectStats = {}
    ids.forEach(id => { stats[id] = { reports: 0, photos: 0, drawings: 0 } })
    insp.forEach(i => { if (i.status === 'COMPLETED' && stats[i.project_id]) stats[i.project_id].reports++ })
    draw.forEach(d => { if (stats[d.project_id]) stats[d.project_id].drawings++ })
    obs.forEach(o => { const pid = toProject.get(o.inspection_id); if (pid && stats[pid]) stats[pid].photos += photoList(o.photos).length })
    await setMeta('projectStats', { ...((await getMeta<ProjectStats>('projectStats')) ?? {}), ...stats })
  }
  return read('projectStats', async () => (await getMeta<ProjectStats>('projectStats')) ?? {}, refresh, onFresh,
    v => Object.keys(v).length === 0)
}

export function photoList(photos: unknown): string[] {
  if (Array.isArray(photos)) return photos
  if (typeof photos === 'string') { try { return JSON.parse(photos) } catch { return [] } }
  return []
}

// ── Drawings ──────────────────────────────────────────────────────────────

export async function listDrawings(projectId: string, onFresh?: Fresh<any[]>): Promise<any[]> {
  const local = async () => sortNewest(await getRows('drawings', { project: projectId }))
  const refresh = async () => {
    const rows = await q<any[]>(supabase.from('drawings').select('*').eq('project_id', projectId))
    await replaceRows('drawings', await getRows('drawings', { project: projectId }), rows)
  }
  return read(`drawings:${projectId}`, local, refresh, onFresh)
}

// ── Site visits (inspections) ─────────────────────────────────────────────

export async function listInspections(projectId: string, onFresh?: Fresh<any[]>): Promise<any[]> {
  const local = async () => sortNewest(await getRows('inspections', { project: projectId }))
  const refresh = async () => {
    const rows = await q<any[]>(supabase.from('inspections').select('*').eq('project_id', projectId))
    await replaceRows('inspections', await getRows('inspections', { project: projectId }), rows)
  }
  return read(`inspections:${projectId}`, local, refresh, onFresh)
}

export function getInspection(id: string): Promise<any | null> {
  return getRow('inspections', id)
}

/** The next report number for the project. Offline it's worked out from the
 *  visits on the phone; the upload moves it on if another visit took it. */
export async function nextReportNo(projectId: string): Promise<string> {
  let rows = await getRows('inspections', { project: projectId })
  if (isOnline()) {
    try {
      const fresh = await q<any[]>(supabase.from('inspections').select('*').eq('project_id', projectId))
      await replaceRows('inspections', rows, fresh)
      rows = await getRows('inspections', { project: projectId })
    } catch { /* the phone's count will do */ }
  }
  const highest = Math.max(rows.length, ...rows.map(r => parseInt(r.report_no, 10) || 0))
  return String(highest + 1).padStart(3, '0')
}

export async function createInspection(fields: Record<string, any>): Promise<any> {
  const row = { id: randomUUID(), created_at: new Date().toISOString(), ...fields, _pending: true }
  await putRow('inspections', row)
  await enqueue(await myId(), 'inspection.insert', row.id, row.id, serverFields(row))
  return row
}

export async function updateInspection(id: string, fields: Record<string, any>): Promise<void> {
  const row = await getRow('inspections', id)
  const server = serverFields(fields)
  const changed = Object.keys(server).length > 0
  if (row) await putRow('inspections', { ...row, ...fields, ...(changed ? { _pending: true } : {}) })
  if (changed) await enqueue(await myId(), 'inspection.update', id, id, server)
}

/** Throws a site visit away: everything still waiting to upload for it is
 *  dropped, and if any of it had reached the server, the server copy is
 *  deleted (with its photos) once there's signal. */
export async function discardInspection(id: string): Promise<void> {
  const reachedServer = !(await neverSent(id, 'inspection.insert'))
  await dropInspection(id)
  const notes = await getRows('observations', { parent: id })
  for (const n of notes) {
    for (const uri of [...photoList(n.photos), ...photoList(n.audio)]) if (isLocal(uri)) await discardFile(uri)
    await deleteRow('observations', n.id)
  }
  const row = await getRow('inspections', id)
  if (row?.project_id) {
    for (const z of await getRows('zones', { project: row.project_id })) {
      if (z.inspection_id === id) await deleteRow('zones', z.id)
    }
  }
  await deleteRow('inspections', id)
  if (reachedServer) await enqueue(await myId(), 'inspection.delete', id, null, {})
}

// ── Drawing mark-ups (zones) ──────────────────────────────────────────────

/** A drawing's mark-ups for one visit (or, with no visit, the ones placed
 *  while just browsing the drawing). */
export async function listZones(drawingId: string, inspectionId: string | null, onFresh?: Fresh<any[]>): Promise<any[]> {
  const local = async () => (await getRows('zones', { parent: drawingId }))
    .filter(z => (z.inspection_id ?? null) === (inspectionId || null))
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
  const refresh = async () => {
    const rows = await q<any[]>(supabase.from('zones').select('*').eq('drawing_id', drawingId))
    await replaceRows('zones', await getRows('zones', { parent: drawingId }), rows)
  }
  return read(`zones:${drawingId}`, local, refresh, onFresh)
}

export async function createZone(fields: Record<string, any>): Promise<any> {
  const row = { id: randomUUID(), created_at: new Date().toISOString(), ...fields, _pending: true }
  await putRow('zones', row)
  await enqueue(await myId(), 'zone.insert', row.id, fields.inspection_id ?? null, serverFields(row))
  return row
}

/** Notes placed on a mark-up, from the phone and (with signal) the server. */
export async function zoneNotes(zoneId: string, projectId: string): Promise<any[]> {
  const byId = new Map<string, any>()
  for (const o of await getRows('observations', { project: projectId })) if (o.zone_id === zoneId) byId.set(o.id, o)
  if (isOnline()) {
    try {
      const rows = await q<any[]>(supabase.from('observations').select('*').eq('zone_id', zoneId))
      for (const r of rows) if (!byId.has(r.id)) { byId.set(r.id, r); await putRow('observations', withProject(r, projectId)) }
    } catch { /* the phone's copy will do */ }
  }
  return [...byId.values()]
}

/** Deletes a mark-up. Its notes are kept, unlinked from it. */
export async function deleteZone(zone: { id: string; project_id?: string; inspection_id?: string | null }, projectId: string): Promise<void> {
  for (const o of await getRows('observations', { project: projectId })) {
    if (o.zone_id === zone.id) await putRow('observations', { ...o, zone_id: null })
  }
  await deleteRow('zones', zone.id)
  await enqueue(await myId(), 'zone.delete', zone.id, zone.inspection_id ?? null, {})
}

// ── Site notes (observations) ─────────────────────────────────────────────

/** Older notes can lack a project id; the phone files them under the
 *  project they were loaded for (a phone-side detail, never sent). */
function withProject(row: any, projectId: string) {
  return row.project_id ? row : { ...row, project_id: projectId }
}

export async function listObservations(inspectionId: string, onFresh?: Fresh<any[]>): Promise<any[]> {
  const local = async () => (await getRows('observations', { parent: inspectionId }))
    .sort((a, b) => String(b.observed_at ?? '').localeCompare(String(a.observed_at ?? '')))
  const refresh = async () => {
    const rows = await q<any[]>(supabase.from('observations').select('*').eq('inspection_id', inspectionId))
    const insp = await getRow('inspections', inspectionId)
    const fresh = insp?.project_id ? rows.map(r => withProject(r, insp.project_id)) : rows
    await replaceRows('observations', await getRows('observations', { parent: inspectionId }), fresh)
  }
  return read(`observations:${inspectionId}`, local, refresh, onFresh)
}

export async function getObservation(id: string): Promise<any | null> {
  const local = await getRow('observations', id)
  if (local || !isOnline()) return local
  try {
    const row = await q<any>(supabase.from('observations').select('*').eq('id', id).single())
    await putRow('observations', row)
    return row
  } catch { return null }
}

/** The note on a mark-up for this visit, if one has been made. */
export async function observationForZone(zoneId: string, inspectionId: string | null, projectId: string): Promise<any | null> {
  const match = (o: any) => o.zone_id === zoneId && (o.inspection_id ?? null) === (inspectionId || null)
  const local = (await getRows('observations', inspectionId ? { parent: inspectionId } : { project: projectId })).find(match)
  if (local || !isOnline()) return local ?? null
  return (await zoneNotes(zoneId, projectId)).find(match) ?? null
}

/** Saves a note — a new one (no id) or changes to an existing one — on the
 *  phone and queues it for upload. Returns the note's id. */
export async function saveObservation(fields: Record<string, any> & { id?: string }): Promise<string> {
  const owner = await myId()
  if (!fields.id) {
    const row: Record<string, any> = { observed_at: new Date().toISOString(), ...fields, id: randomUUID(), _pending: true }
    await putRow('observations', row)
    await enqueue(owner, 'observation.insert', row.id, row.inspection_id ?? null, serverFields(row))
    return row.id
  }
  const { id, ...changes } = fields
  const row = await getRow('observations', id)
  if (row) await putRow('observations', { ...row, ...changes, _pending: true })
  await enqueue(owner, 'observation.update', id, row?.inspection_id ?? fields.inspection_id ?? null, serverFields(changes))
  return id
}

/** Adds dictated text to a note's notes (a transcription that finished
 *  after the note was saved). */
export async function appendTranscript(id: string, text: string): Promise<void> {
  const row = await getRow('observations', id)
  if (!row || !text.trim()) return
  const current = String(row.transcript ?? '').trim()
  await saveObservation({ id, transcript: current ? `${current} ${text.trim()}` : text.trim() })
}

export async function deleteObservation(id: string): Promise<void> {
  const row = await getRow('observations', id)
  const d = await db()
  await d.runAsync('DELETE FROM transcribe_jobs WHERE observation_id = ?', id)
  if (await neverSent(id, 'observation.insert')) {
    await dropTarget(id)
    for (const uri of [...photoList(row?.photos), ...photoList(row?.audio)]) if (isLocal(uri)) await discardFile(uri)
  } else {
    await enqueue(await myId(), 'observation.delete', id, row?.inspection_id ?? null, {})
  }
  await deleteRow('observations', id)
}

function sortNewest(rows: any[]): any[] {
  return [...rows].sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
}

// ── Site notes from finalised reports, and their history ─────────────────

/** Notes of these (finalised) visits — the project's site notes as the
 *  office issued them. */
export async function listProjectNotes(projectId: string, inspectionIds: string[], onFresh?: Fresh<any[]>): Promise<any[]> {
  const ids = new Set(inspectionIds)
  const mine = async () => (await getRows('observations', { project: projectId })).filter(o => ids.has(o.inspection_id))
  const local = async () => (await mine())
    .sort((a, b) => String(b.observed_at ?? '').localeCompare(String(a.observed_at ?? '')))
  const refresh = async () => {
    if (!ids.size) return
    const list = [...ids]
    const rows: any[] = []
    for (let i = 0; i < list.length; i += 100) {
      rows.push(...await q<any[]>(supabase.from('observations').select('*').in('inspection_id', list.slice(i, i + 100))))
    }
    await replaceRows('observations', await mine(), rows.map(r => withProject(r, projectId)))
  }
  return read(`projectNotes:${projectId}`, local, refresh, onFresh)
}

export type NoteFile = { url: string; name: string; type: string | null }
export type NoteResponse = {
  id: string; observation_id: string; comment: string; files: NoteFile[]
  created_at: string; created_by: string | null; _pending?: boolean
}

function toResponse(row: any): NoteResponse {
  const files: NoteFile[] = Array.isArray(row.files) && row.files.length
    ? row.files.filter((f: any) => f?.url)
    : row.file_url ? [{ url: row.file_url, name: row.file_name ?? 'Attachment', type: row.file_type ?? null }] : []
  return {
    id: row.id, observation_id: row.observation_id, comment: row.comment ?? '', files,
    created_at: row.created_at, created_by: row.created_by ?? null, _pending: row._pending,
  }
}

/** A site note's history (comments, photos), oldest first. */
export async function listResponses(observationId: string, onFresh?: Fresh<NoteResponse[]>): Promise<NoteResponse[]> {
  const local = async () => (await getRows('note_responses', { parent: observationId }))
    .map(toResponse)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  const refresh = async () => {
    const rows = await q<any[]>(supabase.from('note_responses').select('*').eq('observation_id', observationId))
    const note = await getRow('observations', observationId)
    await replaceRows('note_responses', await getRows('note_responses', { parent: observationId }),
      rows.map(r => ({ ...r, _project: note?.project_id ?? null })))
  }
  return read(`responses:${observationId}`, local, refresh, onFresh)
}

/** Closes (or reopens) a site note on site, with a comment and photos
 *  (local paths from files.savePhoto). Saved on the phone at once — the
 *  note reads Closed straight away — and sent as one change: photos, then
 *  the comment, then the status (lib/offline/sync). */
export async function respondToNote(
  note: { id: string; inspection_id?: string | null; project_id?: string | null },
  { comment, photos, status }: { comment: string; photos: string[]; status: 'OPEN' | 'CLOSED' | null },
): Promise<void> {
  const owner = await myId()
  const response = {
    id: randomUUID(), observation_id: note.id, comment: comment.trim(),
    files: photos.map((p, i) => ({ url: p, name: `site-photo-${i + 1}.jpg`, type: 'image/jpeg' })),
    created_at: new Date().toISOString(), created_by: owner,
  }
  await putRow('note_responses', { ...response, _pending: true, _project: note.project_id ?? null })
  if (status) {
    const row = await getRow('observations', note.id)
    if (row) {
      await putRow('observations', {
        ...row, severity: status, _pending: true,
        closed_at: status === 'CLOSED' ? new Date().toISOString() : null,
      })
    }
  }
  await enqueue(owner, 'response.insert', response.id, note.inspection_id ?? null,
    { response, observation_id: note.id, set_status: status })
}

/** A mark-up and the drawing it's on, for "View on drawing" — the phone's
 *  copy, else (with signal) the server's, then kept. */
export async function zoneAndDrawing(zoneId: string, projectId: string | null): Promise<{ zone: any; drawing: any } | null> {
  let zone = projectId ? (await getRows('zones', { project: projectId })).find(z => z.id === zoneId) : null
  if (!zone && isOnline()) {
    try {
      zone = await q<any>(supabase.from('zones').select('*').eq('id', zoneId).single())
      if (zone) await putRow('zones', zone)
    } catch { zone = null }
  }
  if (!zone?.drawing_id) return null
  let drawing = await getRow('drawings', zone.drawing_id)
  if (!drawing && isOnline()) {
    try {
      drawing = await q<any>(supabase.from('drawings').select('*').eq('id', zone.drawing_id).single())
      if (drawing) await putRow('drawings', drawing)
    } catch { drawing = null }
  }
  return drawing ? { zone, drawing } : null
}

/** Every mark-up on a drawing, whichever visit made it (for the drawing
 *  opened from the project, which shows the finalised reports' ones). */
export async function listDrawingZones(drawingId: string, onFresh?: Fresh<any[]>): Promise<any[]> {
  const local = async () => (await getRows('zones', { parent: drawingId }))
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
  const refresh = async () => {
    const rows = await q<any[]>(supabase.from('zones').select('*').eq('drawing_id', drawingId))
    await replaceRows('zones', await getRows('zones', { parent: drawingId }), rows)
  }
  return read(`zones:${drawingId}`, local, refresh, onFresh)
}

/** The project's site note numbers (SN 07), from what's on the phone. */
export async function projectNoteNumbers(projectId: string): Promise<Map<string, number>> {
  const reports = await getRows('inspections', { project: projectId })
  const notes = await getRows('observations', { project: projectId })
  return noteRefs(reports, notes)
}
