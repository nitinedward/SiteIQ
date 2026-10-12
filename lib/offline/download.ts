/** Projects kept on the phone for use without signal ("Available offline").
 *
 *  What's kept is the engineer's choice (app/offline-setup, "Keep on this
 *  phone"), since storage on site phones can be tight:
 *  - always: the project's details, drawing list, site visits, mark-ups,
 *    site notes and their history, CANs' details, and small copies of the
 *    drawings for lists — a few hundred KB;
 *  - chosen: full drawing images (current sheets; older revisions), sketch
 *    images, small copies of site-note photos, and each finalised report's
 *    PDF (5–30 MB each).
 *  While there's a connection, kept projects are refreshed when the app
 *  opens, following the same choices. */

import * as FileSystem from 'expo-file-system/legacy'
import { supabase } from '../supabase'
import { latestRevisions } from '../drawingRevisions'
import { db, getRows, putRow, replaceRows, setMeta } from './db'
import { downloadDrawing, forgetDrawing, localFor } from './files'
import { isOnline, withTimeout } from './net'
import { myId, photoList } from './store'
import { loadProjectDocs } from '../projectDocs'
import { thumbRemote } from '../thumbs'
import { isFinalised, removeSavedReport, reportSize, saveReport, savedReport } from '../reports'

const READ_MS = 20_000

export type OfflineProject = { project_id: string; downloaded_at: number; bytes: number }

/** What the engineer chose to keep for a project. */
export type KeepOptions = {
  /** Full images of each sheet's current revision. */
  drawings: boolean
  /** Full images of superseded revisions. */
  older: boolean
  /** Sketch images (from CANs or the office). */
  sketches: boolean
  /** Small copies of site-note photos. */
  photos: boolean
  /** Finalised reports whose PDF is kept. */
  reports: string[]
  /** Keep reports finalised from now on too. */
  newReports: boolean
}

export const DEFAULT_KEEP: Omit<KeepOptions, 'reports'> = {
  drawings: true, older: false, sketches: true, photos: true, newReports: true,
}

const listeners = new Set<() => void>()
export function onOfflineProjectsChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
const changed = () => listeners.forEach(l => l())

async function ensureOptionsColumn() {
  const d = await db()
  await d.execAsync('ALTER TABLE offline_projects ADD COLUMN options TEXT').catch(() => {})
}

export async function offlineProjects(): Promise<OfflineProject[]> {
  const d = await db()
  const owner = await myId()
  return d.getAllAsync<OfflineProject>(
    'SELECT project_id, downloaded_at, bytes FROM offline_projects WHERE owner = ? ORDER BY downloaded_at DESC', owner ?? '')
}

export async function isProjectOffline(projectId: string): Promise<boolean> {
  return (await offlineProjects()).some(p => p.project_id === projectId)
}

/** The choices saved for a kept project; null when it isn't kept. */
export async function keepOptions(projectId: string): Promise<KeepOptions | null> {
  await ensureOptionsColumn()
  const d = await db()
  const row = await d.getFirstAsync<{ options: string | null }>('SELECT options FROM offline_projects WHERE project_id = ?', projectId)
  if (!row) return null
  try { return row.options ? JSON.parse(row.options) : null } catch { return null }
}

async function q<T>(query: PromiseLike<{ data: T | null; error: any }>): Promise<T> {
  const { data, error } = await withTimeout(query, READ_MS)
  if (error) throw new Error(error.message)
  return (data ?? []) as T
}

const isSketch = (d: any) => (d.kind ?? 'drawing') === 'sketch'

/** The project's rows, fetched and kept on the phone (always kept: small). */
async function fetchRows(projectId: string) {
  const project = await q<any>(supabase.from('projects').select('*').eq('id', projectId).single())
  await putRow('projects', project)
  const drawings = await q<any[]>(supabase.from('drawings').select('*').eq('project_id', projectId))
  await replaceRows('drawings', await getRows('drawings', { project: projectId }), drawings)
  const inspections = await q<any[]>(supabase.from('inspections').select('*').eq('project_id', projectId))
  await replaceRows('inspections', await getRows('inspections', { project: projectId }), inspections)
  const zones = await q<any[]>(supabase.from('zones').select('*').eq('project_id', projectId))
  await replaceRows('zones', await getRows('zones', { project: projectId }), zones)
  const ids = inspections.map(i => i.id)
  const notes: any[] = []
  for (let i = 0; i < ids.length; i += 100) {
    notes.push(...await q<any[]>(supabase.from('observations').select('*').in('inspection_id', ids.slice(i, i + 100))))
  }
  await replaceRows('observations', await getRows('observations', { project: projectId }),
    notes.map(n => n.project_id ? n : { ...n, project_id: projectId }))
  // Each site note's history, for closing items with no signal.
  const noteIds = notes.map(n => n.id)
  const responses: any[] = []
  for (let i = 0; i < noteIds.length; i += 100) {
    try {
      responses.push(...await q<any[]>(supabase.from('note_responses').select('*').in('observation_id', noteIds.slice(i, i + 100))))
    } catch { break } // a database without the table yet
  }
  await replaceRows('note_responses', await getRows('note_responses', { project: projectId }),
    responses.map(r => ({ ...r, _project: projectId })))

  await setMeta(`fetched:drawings:${projectId}`, Date.now())
  await setMeta(`fetched:inspections:${projectId}`, Date.now())
  await setMeta(`fetched:projectNotes:${projectId}`, Date.now())
  for (const id of ids) await setMeta(`fetched:observations:${id}`, Date.now())
  for (const id of noteIds) await setMeta(`fetched:responses:${id}`, Date.now())
  await loadProjectDocs(projectId, drawings).catch(() => {})
  return { drawings, inspections, notes }
}

/** The project's files, split as "Keep on this phone" offers them. */
function groups(drawings: any[], inspections: any[], notes: any[]) {
  const sheets = drawings.filter(d => !isSketch(d) && d.preview_url)
  const current = latestRevisions(sheets)
  const currentIds = new Set(current.map(d => d.id))
  const finalised = inspections.filter(isFinalised)
  const finalisedIds = new Set(finalised.map(i => i.id))
  return {
    current,
    older: sheets.filter(d => !currentIds.has(d.id)),
    sketches: drawings.filter(d => isSketch(d) && d.preview_url),
    photos: notes.filter(n => finalisedIds.has(n.inspection_id)).flatMap(n => photoList(n.photos)),
    finalised: finalised.sort((a, b) => String(b.finalised_at ?? b.created_at).localeCompare(String(a.finalised_at ?? a.created_at))),
  }
}

export type ProjectSizes = {
  current: { count: number; bytes: number }
  older: { count: number; bytes: number }
  sketches: { count: number; bytes: number }
  photos: { count: number; bytes: number }
  reports: { id: string; report_no: string; date: string; summary: string | null; bytes: number | null; onPhone: boolean }[]
  /** Free storage on the phone. */
  free: number
}

const PHOTO_THUMB_BYTES = 9_000 // measured: ~7 KB per small copy, rounded up

async function headSize(url: string): Promise<number> {
  try {
    const res = await withTimeout(fetch(url, { method: 'HEAD' }), 10_000)
    return Number(res.headers.get('content-length')) || 0
  } catch { return 0 }
}

/** Runs `fn` over `items`, a few at a time. */
async function inBatches<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn)))
  return out
}

/** How big each choice is, measured before anything large downloads. */
export async function measureProject(projectId: string): Promise<ProjectSizes> {
  if (!isOnline()) throw new Error('No connection — connect to see what can be kept.')
  const { drawings, inspections, notes } = await fetchRows(projectId)
  const g = groups(drawings, inspections, notes)
  const sum = async (rows: any[]) => (await inBatches(rows, 6, d => headSize(d.preview_url))).reduce((a, b) => a + b, 0)
  const [current, older, sketches] = await Promise.all([sum(g.current), sum(g.older), sum(g.sketches)])
  const reports = await inBatches(g.finalised, 3, async ins => {
    const onPhone = await savedReport(ins.id)
    let bytes: number | null = onPhone?.bytes ?? null
    if (!onPhone) { try { bytes = await reportSize(ins.id) } catch { bytes = null } }
    return { id: ins.id, report_no: ins.report_no, date: ins.date, summary: ins.summary ?? null, bytes, onPhone: !!onPhone }
  })
  return {
    current: { count: g.current.length, bytes: current },
    older: { count: g.older.length, bytes: older },
    sketches: { count: g.sketches.length, bytes: sketches },
    photos: { count: g.photos.length, bytes: g.photos.length * PHOTO_THUMB_BYTES },
    reports,
    free: await FileSystem.getFreeDiskStorageAsync(),
  }
}

const busy = new Map<string, Promise<void>>()

/** Downloads (or refreshes) a project for offline use, keeping what
 *  `options` says (by default: what was chosen last time) and freeing what
 *  it no longer includes. `onProgress` gets a fraction 0–1 and what's being
 *  fetched. */
export function downloadProject(
  projectId: string,
  onProgress?: (fraction: number, what: string) => void,
  chosen?: KeepOptions,
): Promise<void> {
  const running = busy.get(projectId)
  if (running) return running
  const job = (async () => {
    if (!isOnline()) throw new Error('No connection — connect to download this project.')
    const step = (f: number, what: string) => onProgress?.(f, what)

    step(0.02, 'Project details')
    const { drawings, inspections, notes } = await fetchRows(projectId)
    const g = groups(drawings, inspections, notes)
    const before = await keepOptions(projectId)
    const options: KeepOptions = chosen ?? (before
      ? {
          ...before,
          // Reports finalised since: kept if "new reports" is on.
          reports: before.newReports
            ? [...new Set([...before.reports, ...g.finalised.filter(i => !before.reports.includes(i.id) && !(before as any).seen?.includes(i.id)).map(i => i.id)])]
            : before.reports,
        }
      : { ...DEFAULT_KEEP, reports: g.finalised.map(i => i.id) })

    // Free what's no longer chosen.
    const drop = async (urls: string[]) => { for (const u of urls) await forgetDrawing(u) }
    if (!options.drawings) await drop(g.current.map(d => d.preview_url))
    if (!options.older) await drop(g.older.map(d => d.preview_url))
    if (!options.sketches) await drop(g.sketches.map(d => d.preview_url))
    if (!options.photos) await drop(g.photos.map(thumbRemote))
    for (const ins of g.finalised) if (!options.reports.includes(ins.id)) await removeSavedReport(ins.id)

    // Fetch what is.
    const jobs: { what: string; run: () => Promise<number> }[] = []
    const keepImage = (d: any, what: string) => jobs.push({ what, run: async () => {
      const bytes = await downloadDrawing(d.preview_url)
      await setMeta(`fetched:zones:${d.id}`, Date.now())
      return bytes
    } })
    if (options.drawings) g.current.forEach((d, i) => keepImage(d, `Drawing ${i + 1} of ${g.current.length}`))
    if (options.older) g.older.forEach((d, i) => keepImage(d, `Older revision ${i + 1} of ${g.older.length}`))
    if (options.sketches) g.sketches.forEach((d, i) => keepImage(d, `Sketch ${i + 1} of ${g.sketches.length}`))
    // Small copies of every drawing and sketch, for lists: always (tiny).
    for (const d of drawings.filter(x => x.preview_url)) {
      jobs.push({ what: 'Thumbnails', run: () => downloadDrawing(thumbRemote(d.preview_url)).catch(() => 0) })
    }
    if (options.photos) for (const url of g.photos) {
      jobs.push({ what: 'Site note photos', run: () => downloadDrawing(thumbRemote(url)).catch(() => 0) })
    }
    for (const ins of g.finalised.filter(i => options.reports.includes(i.id))) {
      jobs.push({ what: `Report SR ${ins.report_no}`, run: async () => {
        const path = await saveReport(ins.id).catch(() => null)
        if (!path) return 0
        const info = await FileSystem.getInfoAsync(path)
        return info.exists ? info.size ?? 0 : 0
      } })
    }

    let bytes = 0
    for (let i = 0; i < jobs.length; i++) {
      step(0.08 + 0.9 * (i / Math.max(1, jobs.length)), jobs[i].what)
      bytes += await jobs[i].run()
    }

    await ensureOptionsColumn()
    const d = await db()
    // `seen`: the reports there were when this was chosen, so "new reports"
    // means ones finalised after — a report the engineer left out stays out.
    const stored = { ...options, seen: g.finalised.map(i => i.id) }
    await d.runAsync(
      'INSERT OR REPLACE INTO offline_projects (project_id, owner, downloaded_at, bytes, options) VALUES (?, ?, ?, ?, ?)',
      projectId, await myId(), Date.now(), bytes, JSON.stringify(stored))
    step(1, 'Done')
    changed()
  })()
  busy.set(projectId, job)
  job.finally(() => busy.delete(projectId)).catch(() => {})
  return job
}

/** Stops keeping a project offline and frees the space its files took.
 *  Anything still waiting to upload is unaffected. */
export async function removeOfflineProject(projectId: string): Promise<void> {
  for (const drawing of await getRows('drawings', { project: projectId })) {
    if (!drawing.preview_url) continue
    await forgetDrawing(drawing.preview_url)
    await forgetDrawing(thumbRemote(drawing.preview_url))
  }
  for (const note of await getRows('observations', { project: projectId })) {
    for (const url of photoList(note.photos)) {
      const small = thumbRemote(url)
      if (localFor(small) !== small) await forgetDrawing(small)
    }
  }
  for (const ins of await getRows('inspections', { project: projectId })) await removeSavedReport(ins.id)
  const d = await db()
  await d.runAsync('DELETE FROM offline_projects WHERE project_id = ?', projectId)
  changed()
}

/** Brings every kept project up to date, following each one's choices.
 *  Called when the app opens with a connection; failures are left for the
 *  next time. */
export async function refreshOfflineProjects(): Promise<void> {
  if (!isOnline()) return
  for (const p of await offlineProjects()) {
    try { await downloadProject(p.project_id) }
    catch (err: any) { console.warn('[offline] refresh', p.project_id, err?.message ?? err) }
  }
}
