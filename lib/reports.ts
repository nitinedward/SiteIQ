/** Finalised site reports on the phone.
 *
 *  Finalising a report on the web saves a fixed PDF of it (private storage;
 *  /api/docs/pdf-url hands out a short-lived link) and marks the inspection
 *  report_status 'finalised'. The app lists those reports, opens the PDF in
 *  its own viewer, and keeps a downloaded copy so it opens again instantly
 *  and with no signal. Which ones are kept is the engineer's choice
 *  (app/offline-setup) — reports with photos run to tens of MB. */

import * as FileSystem from 'expo-file-system/legacy'
import { supabase } from './supabase'
import { db } from './offline/db'
import { isOnline, withTimeout } from './offline/net'

const DEFAULT_APP_URL = 'https://www.site-iq.co.nz'
const DIR = `${FileSystem.documentDirectory}offline/reports/`

function apiBase(): string {
  const raw = (process.env.EXPO_PUBLIC_APP_URL ?? DEFAULT_APP_URL).trim().replace(/\/+$/, '')
  return raw.replace(/^https:\/\/site-iq\.co\.nz/i, DEFAULT_APP_URL)
}

/** Kept in the files table under this made-up address, so the phone's
 *  copies are listed with the rest of what it stores. */
const keyFor = (inspectionId: string) => `siteiq-report:${inspectionId}`

export const isFinalised = (inspection: { report_status?: string | null }) =>
  inspection.report_status === 'finalised'

/** Completed on site, not yet finalised in the office. */
export const isInOffice = (inspection: { status?: string | null; report_status?: string | null }) =>
  inspection.status === 'COMPLETED' && !isFinalised(inspection)

/** A short-lived link to a finalised report's PDF; null when it has none
 *  (finalised before PDFs were kept). Throws without a connection. */
export async function reportPdfLink(inspectionId: string): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Please sign in again.')
  const res = await withTimeout(fetch(`${apiBase()}/api/docs/pdf-url?inspectionId=${encodeURIComponent(inspectionId)}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  }), 15_000)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Could not get the report (${res.status})`)
  const body = await res.json()
  return body?.url ?? null
}

/** The phone's copy of a report's PDF, or null. */
export async function savedReport(inspectionId: string): Promise<{ path: string; bytes: number } | null> {
  const d = await db()
  const row = await d.getFirstAsync<{ local: string }>('SELECT local FROM files WHERE remote = ?', keyFor(inspectionId))
  if (!row) return null
  const info = await FileSystem.getInfoAsync(row.local)
  if (!info.exists) {
    await d.runAsync('DELETE FROM files WHERE remote = ?', keyFor(inspectionId))
    return null
  }
  return { path: row.local, bytes: info.size ?? 0 }
}

/** The ids of every report kept on the phone. */
export async function savedReportIds(): Promise<Set<string>> {
  const d = await db()
  const rows = await d.getAllAsync<{ remote: string }>("SELECT remote FROM files WHERE kind = 'report'")
  return new Set(rows.map(r => r.remote.replace('siteiq-report:', '')))
}

/** Size of a report's PDF before downloading it; null if it has none. */
export async function reportSize(inspectionId: string): Promise<number | null> {
  const link = await reportPdfLink(inspectionId)
  if (!link) return null
  const res = await withTimeout(fetch(link, { method: 'HEAD' }), 15_000)
  const length = Number(res.headers.get('content-length'))
  return Number.isFinite(length) && length > 0 ? length : 0
}

const downloading = new Map<string, Promise<string | null>>()

/** Downloads a report's PDF to the phone (once; a second call joins the
 *  first). Returns its path, or null when the report has no PDF. */
export function saveReport(inspectionId: string): Promise<string | null> {
  const running = downloading.get(inspectionId)
  if (running) return running
  const job = (async () => {
    const already = await savedReport(inspectionId)
    if (already) return already.path
    const link = await reportPdfLink(inspectionId)
    if (!link) return null
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {})
    const path = `${DIR}${inspectionId}.pdf`
    const part = `${path}.part`
    const res = await FileSystem.downloadAsync(link, part)
    if (res.status !== 200) {
      await FileSystem.deleteAsync(part, { idempotent: true })
      throw new Error(`Report download failed (${res.status})`)
    }
    await FileSystem.deleteAsync(path, { idempotent: true })
    await FileSystem.moveAsync({ from: part, to: path })
    const d = await db()
    await d.runAsync(
      "INSERT OR REPLACE INTO files (local, remote, kind, uploaded, created_at, uploaded_at) VALUES (?, ?, 'report', 1, ?, ?)",
      path, keyFor(inspectionId), Date.now(), Date.now())
    return path
  })()
  downloading.set(inspectionId, job)
  job.finally(() => downloading.delete(inspectionId)).catch(() => {})
  return job
}

export async function removeSavedReport(inspectionId: string): Promise<void> {
  const saved = await savedReport(inspectionId)
  const d = await db()
  await d.runAsync('DELETE FROM files WHERE remote = ?', keyFor(inspectionId))
  if (saved) await FileSystem.deleteAsync(saved.path, { idempotent: true })
}

/** What the viewer should open: the phone's copy, else (with signal) a
 *  fresh download. Null when the report has no PDF; throws offline. */
export async function reportForViewing(inspectionId: string): Promise<string | null> {
  const saved = await savedReport(inspectionId)
  if (saved) return saved.path
  if (!isOnline()) throw new Error("This report isn't on the phone. Open it once with signal, or keep it offline.")
  return saveReport(inspectionId)
}
