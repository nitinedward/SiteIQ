/** Projects kept on the phone for use without signal ("Available offline").
 *
 *  Downloading copies a project's details, drawings (with their images and
 *  small copies for lists), its CANs' details and sketches, site visits,
 *  mark-ups and notes; photos of earlier visits stay on the web, and so
 *  does a CAN's full PDF, to keep the download small. While there's a connection, kept
 *  projects are refreshed when the app opens, so the copy on the phone
 *  stays current. */

import { supabase } from '../supabase'
import { latestRevisions } from '../drawingRevisions'
import { db, getRows, putRow, replaceRows, setMeta } from './db'
import { downloadDrawing, forgetDrawing } from './files'
import { isOnline, withTimeout } from './net'
import { myId } from './store'
import { loadProjectDocs } from '../projectDocs'
import { thumbRemote } from '../thumbs'

const READ_MS = 20_000

export type OfflineProject = { project_id: string; downloaded_at: number; bytes: number }

const listeners = new Set<() => void>()
export function onOfflineProjectsChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
const changed = () => listeners.forEach(l => l())

export async function offlineProjects(): Promise<OfflineProject[]> {
  const d = await db()
  const owner = await myId()
  return d.getAllAsync<OfflineProject>(
    'SELECT project_id, downloaded_at, bytes FROM offline_projects WHERE owner = ? ORDER BY downloaded_at DESC', owner ?? '')
}

export async function isProjectOffline(projectId: string): Promise<boolean> {
  return (await offlineProjects()).some(p => p.project_id === projectId)
}

async function q<T>(query: PromiseLike<{ data: T | null; error: any }>): Promise<T> {
  const { data, error } = await withTimeout(query, READ_MS)
  if (error) throw new Error(error.message)
  return (data ?? []) as T
}

const busy = new Map<string, Promise<void>>()

/** Downloads (or refreshes) a project for offline use. `onProgress` gets a
 *  fraction 0–1 and what's being fetched. */
export function downloadProject(projectId: string, onProgress?: (fraction: number, what: string) => void): Promise<void> {
  const running = busy.get(projectId)
  if (running) return running
  const job = (async () => {
    if (!isOnline()) throw new Error('No connection — connect to download this project.')
    const step = (f: number, what: string) => onProgress?.(f, what)

    step(0.02, 'Project details')
    const project = await q<any>(supabase.from('projects').select('*').eq('id', projectId).single())
    await putRow('projects', project)

    step(0.06, 'Drawings')
    const drawings = await q<any[]>(supabase.from('drawings').select('*').eq('project_id', projectId))
    await replaceRows('drawings', await getRows('drawings', { project: projectId }), drawings)

    step(0.1, 'Site reports')
    const inspections = await q<any[]>(supabase.from('inspections').select('*').eq('project_id', projectId))
    await replaceRows('inspections', await getRows('inspections', { project: projectId }), inspections)

    step(0.14, 'Mark-ups')
    const zones = await q<any[]>(supabase.from('zones').select('*').eq('project_id', projectId))
    await replaceRows('zones', await getRows('zones', { project: projectId }), zones)

    step(0.18, 'Site notes')
    const ids = inspections.map(i => i.id)
    const notes: any[] = []
    for (let i = 0; i < ids.length; i += 100) {
      notes.push(...await q<any[]>(supabase.from('observations').select('*').in('inspection_id', ids.slice(i, i + 100))))
    }
    await replaceRows('observations', await getRows('observations', { project: projectId }),
      notes.map(n => n.project_id ? n : { ...n, project_id: projectId }))

    await setMeta(`fetched:drawings:${projectId}`, Date.now())
    await setMeta(`fetched:inspections:${projectId}`, Date.now())
    for (const id of ids) await setMeta(`fetched:observations:${id}`, Date.now())

    step(0.19, 'CANs and sketches')
    // Remembered on the phone for the CAN and sketch screens (lib/projectDocs).
    await loadProjectDocs(projectId, drawings).catch(() => {})

    // Full images of the current sheets and every sketch (sketches share a
    // "number", so they aren't revisions of each other); superseded
    // revisions open with signal. Small copies of all of them, for lists.
    const isSketch = (d: any) => (d.kind ?? 'drawing') === 'sketch'
    const sheets = [...latestRevisions(drawings.filter(d => !isSketch(d))), ...drawings.filter(isSketch)]
      .filter(d => d.preview_url)
    const smalls = drawings.filter(d => d.preview_url)
    const total = sheets.length + smalls.length
    let bytes = 0
    let done = 0
    for (const sheet of sheets) {
      step(0.2 + 0.78 * (done++ / Math.max(1, total)), `Drawing ${done} of ${sheets.length}`)
      bytes += await downloadDrawing(sheet.preview_url)
      await setMeta(`fetched:zones:${sheet.id}`, Date.now())
    }
    for (const d of smalls) {
      step(0.2 + 0.78 * (done++ / Math.max(1, total)), 'Thumbnails')
      // A missing small copy only means a placeholder in the list.
      bytes += await downloadDrawing(thumbRemote(d.preview_url)).catch(() => 0)
    }

    const d = await db()
    await d.runAsync(
      'INSERT OR REPLACE INTO offline_projects (project_id, owner, downloaded_at, bytes) VALUES (?, ?, ?, ?)',
      projectId, await myId(), Date.now(), bytes)
    step(1, 'Done')
    changed()
  })()
  busy.set(projectId, job)
  job.finally(() => busy.delete(projectId)).catch(() => {})
  return job
}

/** Stops keeping a project offline and frees the space its drawings took.
 *  Anything still waiting to upload is unaffected. */
export async function removeOfflineProject(projectId: string): Promise<void> {
  for (const drawing of await getRows('drawings', { project: projectId })) {
    if (!drawing.preview_url) continue
    await forgetDrawing(drawing.preview_url)
    await forgetDrawing(thumbRemote(drawing.preview_url))
  }
  const d = await db()
  await d.runAsync('DELETE FROM offline_projects WHERE project_id = ?', projectId)
  changed()
}

/** Brings every kept project up to date. Called when the app opens with a
 *  connection; failures are left for the next time. */
export async function refreshOfflineProjects(): Promise<void> {
  if (!isOnline()) return
  for (const p of await offlineProjects()) {
    try { await downloadProject(p.project_id) }
    catch (err: any) { console.warn('[offline] refresh', p.project_id, err?.message ?? err) }
  }
}
