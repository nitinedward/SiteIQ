/** The queue of changes made on the phone, waiting to go up to the server
 *  in the order they were made (run by lib/offline/sync).
 *
 *  Edits to something whose earlier change hasn't gone up yet are folded
 *  into that change, so editing a note five times offline sends it once. */

import { db } from './db'

export type OpKind =
  | 'inspection.insert' | 'inspection.update' | 'inspection.delete'
  | 'zone.insert' | 'zone.delete'
  | 'observation.insert' | 'observation.update' | 'observation.delete'
  /** A comment (with photos) on a site note, usually closing or reopening it. */
  | 'response.insert'

export type Op = {
  seq: number
  owner: string | null
  kind: OpKind
  target: string
  inspection_id: string | null
  payload: any
  attempts: number
  last_error: string | null
  failed: number
}

/** The op the upload queue is sending right now; never folded into or
 *  dropped, since the server may already have it. */
let inFlight: number | null = null
export function setInFlight(seq: number | null) { inFlight = seq }

const listeners = new Set<() => void>()
export function onOutboxChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function outboxChanged() { listeners.forEach(l => l()) }

export async function enqueue(
  owner: string | null, kind: OpKind, target: string, inspectionId: string | null, payload: any,
): Promise<void> {
  const d = await db()
  if (kind.endsWith('.update')) {
    // Fold into a waiting insert or update of the same thing.
    const entity = kind.split('.')[0]
    const last = await d.getFirstAsync<{ seq: number; kind: string; payload: string }>(
      `SELECT seq, kind, payload FROM outbox WHERE target = ? AND failed = 0 ORDER BY seq DESC LIMIT 1`, target)
    if (last && last.seq !== inFlight && (last.kind === `${entity}.insert` || last.kind === `${entity}.update`)) {
      const merged = { ...JSON.parse(last.payload), ...payload }
      await d.runAsync('UPDATE outbox SET payload = ? WHERE seq = ?', JSON.stringify(merged), last.seq)
      outboxChanged()
      return
    }
  }
  await d.runAsync(
    'INSERT INTO outbox (owner, kind, target, inspection_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    owner, kind, target, inspectionId, JSON.stringify(payload), Date.now())
  outboxChanged()
}

/** Whether `target` was created on the phone and hasn't reached the server
 *  at all — then deleting it is just forgetting it. */
export async function neverSent(target: string, insertKind: OpKind): Promise<boolean> {
  const d = await db()
  const row = await d.getFirstAsync<{ seq: number }>(
    'SELECT seq FROM outbox WHERE target = ? AND kind = ? AND attempts = 0', target, insertKind)
  return !!row && row.seq !== inFlight
}

/** Drops every waiting change to `target` (it's being thrown away before it
 *  ever went up). */
export async function dropTarget(target: string): Promise<void> {
  const d = await db()
  await d.runAsync('DELETE FROM outbox WHERE target = ? AND seq IS NOT ?', target, inFlight)
  outboxChanged()
}

/** Drops every waiting change belonging to a site visit. */
export async function dropInspection(inspectionId: string): Promise<void> {
  const d = await db()
  await d.runAsync('DELETE FROM outbox WHERE (inspection_id = ? OR target = ?) AND seq IS NOT ?', inspectionId, inspectionId, inFlight)
  outboxChanged()
}

/** The next change to send; `skip` names ones held back this pass (waiting
 *  for Wi-Fi, say) so the queue moves past them. */
export async function nextOp(owner: string, skip: number[] = []): Promise<Op | null> {
  const d = await db()
  const r = await d.getFirstAsync<any>(
    `SELECT * FROM outbox WHERE failed = 0 AND (owner = ? OR owner IS NULL)
       ${skip.length ? `AND seq NOT IN (${skip.map(() => '?').join(',')})` : ''} ORDER BY seq LIMIT 1`, owner, ...skip)
  return r ? { ...r, payload: JSON.parse(r.payload) } : null
}

export async function completeOp(seq: number): Promise<void> {
  const d = await db()
  await d.runAsync('DELETE FROM outbox WHERE seq = ?', seq)
  outboxChanged()
}

export async function recordFailure(seq: number, message: string, permanent: boolean): Promise<void> {
  const d = await db()
  await d.runAsync(
    `UPDATE outbox SET attempts = attempts + 1, last_error = ?,
       failed = CASE WHEN ? AND attempts + 1 >= 3 THEN 1 ELSE failed END
     WHERE seq = ?`, message.slice(0, 500), permanent ? 1 : 0, seq)
  outboxChanged()
}

/** Whether any change to `target` is still waiting to go up. */
export async function hasPending(target: string): Promise<boolean> {
  const d = await db()
  const r = await d.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM outbox WHERE target = ?', target)
  return (r?.n ?? 0) > 0
}

export type QueueCounts = { waiting: number; failed: number; inspections: string[] }

export async function queueCounts(owner: string | null): Promise<QueueCounts> {
  const d = await db()
  const rows = await d.getAllAsync<{ failed: number; inspection_id: string | null }>(
    'SELECT failed, inspection_id FROM outbox WHERE owner = ? OR owner IS NULL', owner ?? '')
  return {
    waiting: rows.filter(r => !r.failed).length,
    failed: rows.filter(r => r.failed).length,
    inspections: [...new Set(rows.map(r => r.inspection_id).filter(Boolean) as string[])],
  }
}

export async function failedOps(owner: string | null): Promise<Op[]> {
  const d = await db()
  const rows = await d.getAllAsync<any>(
    'SELECT * FROM outbox WHERE failed = 1 AND (owner = ? OR owner IS NULL) ORDER BY seq', owner ?? '')
  return rows.map(r => ({ ...r, payload: JSON.parse(r.payload) }))
}

/** Puts changes that gave up back in the queue, to try again. */
export async function retryFailed(): Promise<void> {
  const d = await db()
  await d.runAsync('UPDATE outbox SET failed = 0, attempts = 0 WHERE failed = 1')
  outboxChanged()
}
